import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db, ObjectId } from 'mongodb';
import { z } from 'zod';
import type { MagicLinkService } from '../auth/magic-link-service.js';
import type { GoogleOAuthService } from '../auth/google-oauth-service.js';
import type { JwtService } from '../auth/jwt-service.js';
import { buildAuthGuard } from '../middleware/auth-guard.js';
import { usersCollection } from '../db/models/user.js';
import type { User } from '../db/models/user.js';
import type { EmailRateLimiter } from '../lib/email-rate-limiter.js';
import { checkFingerprintAllowed, computeFingerprint } from '../lib/fingerprint.js';

const magicLinkRequestBody = z.object({
  email: z.string().email('Invalid email address'),
  /** Chrome extension ID — when present, verify will bridge-redirect to chromiumapp.org */
  extensionId: z.string().optional(),
});

const googleCallbackBody = z.object({
  idToken: z.string().min(1, 'idToken is required'),
});

export interface AuthRoutesOptions {
  magicLinkService: MagicLinkService;
  googleOAuthService: GoogleOAuthService;
  jwtService: JwtService;
  /** Rate limiter for /magic-link/request — keyed per email, 5 req/hour */
  emailRateLimiter: EmailRateLimiter;
  /** Base URL for the backend (e.g. http://localhost:3000) */
  baseUrl: string;
  /** Allowlisted Chrome extension IDs. Empty array = dev mode (allow any). */
  allowedExtensionIds: string[];
  /** Google OAuth client ID for building the auth URL */
  googleClientId: string;
  /** MongoDB handle for fingerprint check + $addToSet on sign-in */
  db: Db;
  /** Max accounts sharing the same fingerprint before blocking sign-up. 0 = disabled. */
  maxAccountsPerFingerprint: number;
}

function fingerprintFromRequest(request: FastifyRequest, extensionId?: string): string {
  return computeFingerprint({
    ip: request.ip,
    userAgent: (request.headers['user-agent'] as string | undefined) ?? '',
    extensionId,
  });
}

async function recordFingerprint(db: Db, userId: ObjectId, fingerprint: string): Promise<void> {
  await usersCollection(db).updateOne(
    { _id: userId },
    { $addToSet: { fingerprints: fingerprint } },
  );
}

function userToDto(user: User) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    picture: user.picture,
  };
}

/**
 * Returns true if the extension ID is allowlisted.
 * In dev mode (empty allowlist) every ID is allowed.
 */
function isExtensionAllowed(extensionId: string, allowedIds: string[]): boolean {
  if (allowedIds.length === 0) return true; // dev mode — allow all
  return allowedIds.includes(extensionId);
}

/** Build the chromiumapp.org redirect URL that chrome.identity.launchWebAuthFlow listens on. */
function chromiumAppUrl(extensionId: string, token: string): string {
  return `https://${extensionId}.chromiumapp.org/?token=${encodeURIComponent(token)}`;
}

/** Minimal HTML page shown when bridge mode is active. Meta-refresh + JS fallback. */
function bridgeHtmlPage(redirectUrl: string, jwt: string): string {
  const safeToken = jwt.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeRedirect = redirectUrl.replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${safeRedirect}">
<title>Đăng nhập thành công</title>
<style>body{font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px}</style>
</head>
<body>
<h2>Đăng nhập thành công</h2>
<p>Đang chuyển hướng về extension...</p>
<p id="fallback" style="display:none">
  Nếu không tự động chuyển, sao chép token bên dưới và dán vào extension:
</p>
<textarea id="token" readonly rows="4" style="width:100%;display:none;font-size:11px;word-break:break-all">${safeToken}</textarea>
<button id="copy" style="display:none;margin-top:8px;padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer">
  Sao chép token
</button>
<script>
try { window.location.href = "${safeRedirect}"; } catch(e) {}
setTimeout(function(){
  document.getElementById('fallback').style.display='block';
  document.getElementById('token').style.display='block';
  document.getElementById('copy').style.display='inline-block';
},1500);
document.getElementById('copy').addEventListener('click',function(){
  var t=document.getElementById('token');
  t.select();
  document.execCommand('copy');
  this.textContent='Đã sao chép!';
});
</script>
</body>
</html>`;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions): Promise<void> {
  const {
    magicLinkService,
    googleOAuthService,
    jwtService,
    emailRateLimiter,
    allowedExtensionIds,
    db,
    maxAccountsPerFingerprint,
  } = opts;
  const authGuard = buildAuthGuard(jwtService);

  // POST /magic-link/request — rate-limited 5/hour per email
  app.post('/magic-link/request', async (request, reply) => {
    const parsed = magicLinkRequestBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      });
    }

    const { email, extensionId } = parsed.data;

    // Validate extension ID if provided
    if (extensionId && !isExtensionAllowed(extensionId, allowedExtensionIds)) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Extension ID not allowlisted',
      });
    }

    if (!emailRateLimiter.check(email)) {
      return reply.status(429).send({
        code: 'RATE_LIMITED',
        message: 'Too many requests — try again later',
      });
    }

    // Free-tier abuse guard — block new sign-ups from a device that already
    // backs N other accounts. Existing-user sign-ins pass through (the helper
    // matches email+fingerprint pairs already on file).
    const fingerprint = fingerprintFromRequest(request, extensionId);
    const fpCheck = await checkFingerprintAllowed({
      db,
      fingerprint,
      email,
      maxAccounts: maxAccountsPerFingerprint,
    });
    if (!fpCheck.allowed) {
      return reply.status(429).send({
        code: 'FINGERPRINT_LIMIT',
        message: 'Too many accounts from this device — contact support if this is a mistake.',
      });
    }

    await magicLinkService.request(email, extensionId);
    return reply.status(204).send();
  });

  // GET /magic-link/verify?token=...
  // When extensionId stored with token: returns bridge HTML page instead of JSON
  app.get('/magic-link/verify', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const rawToken = query['token'];

    if (!rawToken) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'token is required' });
    }

    const { user, extensionId } = await magicLinkService.verify(rawToken);
    // Record the device fingerprint AFTER the token is verified (signal collection
    // for future free-tier abuse blocks; the upfront check fires at /request).
    await recordFingerprint(db, user._id, fingerprintFromRequest(request, extensionId));
    const jwt = await jwtService.sign({ userId: user._id.toString(), email: user.email });

    if (extensionId) {
      // Extension bridge mode: redirect to chromiumapp.org (launchWebAuthFlow listens here)
      const redirectUrl = chromiumAppUrl(extensionId, jwt);
      const html = bridgeHtmlPage(redirectUrl, jwt);
      return reply.status(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
    }

    return reply.status(200).send({ token: jwt, user: userToDto(user) });
  });

  // POST /google/callback — ID token flow (existing, from in-browser chrome.identity)
  app.post('/google/callback', async (request, reply) => {
    const parsed = googleCallbackBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      });
    }

    const user = await googleOAuthService.verifyIdToken(parsed.data.idToken);
    await recordFingerprint(db, user._id, fingerprintFromRequest(request));
    const jwt = await jwtService.sign({ userId: user._id.toString(), email: user.email });

    return reply.status(200).send({ token: jwt, user: userToDto(user) });
  });

  // GET /google/extension-start?extension_id=<id>
  // Starts the OAuth code flow for the Chrome extension via launchWebAuthFlow.
  // Returns 302 redirect to Google's OAuth consent page.
  app.get('/google/extension-start', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const extensionId = query['extension_id'];

    if (!extensionId) {
      return reply
        .status(400)
        .send({ code: 'VALIDATION_ERROR', message: 'extension_id is required' });
    }

    if (!isExtensionAllowed(extensionId, allowedExtensionIds)) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Extension ID not allowlisted' });
    }

    // State encodes extensionId + a short-lived CSRF token (signed JWT, 5-min TTL).
    // Not a user session JWT — userId/email stubs satisfy JwtClaims shape; cast intentional.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statePayload = await jwtService.sign({ extensionId, userId: '', email: '' } as any, '5m');
    const authUrl = googleOAuthService.buildAuthUrl(statePayload);

    return reply.redirect(authUrl, 302);
  });

  // GET /google/callback?code=<code>&state=<state>
  // OAuth code flow callback. Exchanges code, issues JWT, redirects to chromiumapp.org.
  app.get('/google/callback', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const code = query['code'];
    const state = query['state'];
    const error = query['error'];

    if (error) {
      return reply.status(400).send({ code: 'OAUTH_ERROR', message: error });
    }

    if (!code || !state) {
      return reply
        .status(400)
        .send({ code: 'VALIDATION_ERROR', message: 'code and state are required' });
    }

    // Verify state JWT → extract extensionId
    let extensionId: string;
    try {
      const payload = await jwtService.verifyRaw(state);
      const ext = payload['extensionId'];
      if (typeof ext !== 'string' || !ext) {
        throw new Error('extensionId missing from state');
      }
      extensionId = ext;
    } catch {
      return reply
        .status(400)
        .send({ code: 'INVALID_STATE', message: 'Invalid or expired state parameter' });
    }

    if (!isExtensionAllowed(extensionId, allowedExtensionIds)) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Extension ID not allowlisted' });
    }

    const user = await googleOAuthService.exchangeCode(code);
    await recordFingerprint(db, user._id, fingerprintFromRequest(request, extensionId));
    const jwt = await jwtService.sign({ userId: user._id.toString(), email: user.email });

    // Redirect to the chromiumapp.org URL — chrome.identity.launchWebAuthFlow captures this
    const redirectUrl = chromiumAppUrl(extensionId, jwt);
    return reply.redirect(redirectUrl, 302);
  });

  // POST /logout — stateless JWT; exists for parity + future revocation list
  app.post('/logout', { preHandler: authGuard }, async (_request, reply) => {
    return reply.status(204).send();
  });

  // POST /ws-ticket — exchange long-lived auth JWT for a 1-hour WS-only ticket.
  // The WS handshake passes ?token=... in the URL, which leaks into access logs;
  // the short TTL + scope:'ws' claim caps the blast radius if a ticket is grabbed.
  // Client flow: call this right before opening the WS, discard ticket after.
  app.post('/ws-ticket', { preHandler: authGuard }, async (request, reply) => {
    const { userId, email } = request.user!;
    const ticket = await jwtService.sign({ userId, email, scope: 'ws' }, '1h');
    return reply.status(200).send({ ticket, expiresIn: 3600 });
  });

  // GET /me — protected
  app.get('/me', { preHandler: authGuard }, async (request, reply) => {
    return reply.status(200).send({ user: request.user });
  });
}
