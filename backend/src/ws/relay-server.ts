import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { JwtService } from '../auth/jwt-service.js';
import { verifyWsToken } from './auth-handshake.js';
import { parseFrame } from './audio-protocol.js';
import { SessionManager } from './session-manager.js';
import { BackpressureMonitor } from './backpressure-monitor.js';
import { emitLifecycleEvent } from './connection-lifecycle.js';
import { DeepgramNova2Provider } from '../providers/asr/deepgram-nova2-provider.js';
import { GeminiFlashProvider } from '../providers/translate/gemini-flash-provider.js';
import { AzureTranslateProvider } from '../providers/translate/azure-translate-provider.js';
import { GroqTranslateProvider } from '../providers/translate/groq-translate-provider.js';
import { GoogleCloudTtsProvider } from '../providers/tts/google-cloud-tts-provider.js';
import { AzureTtsProvider } from '../providers/tts/azure-tts-provider.js';
import { TtsProviderChain } from '../providers/tts/tts-provider-chain.js';
import type { TranslateProvider } from '../providers/translate/translate-provider-interface.js';
import type { TTSProvider } from '../providers/tts/tts-provider-interface.js';
import type { Env } from '../config/env.js';
import { PipelineOrchestrator } from '../pipeline/pipeline-orchestrator.js';
import { WS_CLOSE_CODES, ALLOWED_SRC_LANGS } from '@translate-voice/shared';
import type { ServerControlFrame } from '@translate-voice/shared';
import type { UsageTracker } from '../lib/usage-tracker.js';
import { checkUsageGate } from '../middleware/usage-gate-middleware.js';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Module-level session manager — one instance shared across all connections
const sessionManager = new SessionManager();

export interface RelayServerOptions {
  jwtService: JwtService;
  deepgramApiKey: string;
  geminiApiKey?: string;
  azureTranslatorKey?: string;
  groqApiKey?: string;
  translateProvider?: 'gemini' | 'azure' | 'groq';
  googleCloudTtsKeyFile?: string;
  googleCloudTtsCredentialsJson?: string;
  azureSpeechKey?: string;
  azureSpeechRegion?: string;
  /** UsageTracker instance — required for usage gate + mid-stream tick */
  usageTracker?: UsageTracker;
  /** When true, orchestrator emits translation text but skips TTS synthesis.
   *  Extension speaks via browser speechSynthesis instead. */
  backendTtsDisabled?: boolean;
}

/** Choose translate provider based on env config. Falls back to Gemini when the
 *  selected provider's key is absent — keeps dev/test working even when env is
 *  incomplete. Order of preference: explicit choice → fallback Gemini. */
export function pickTranslateProvider(
  env: Pick<Env, 'TRANSLATE_PROVIDER' | 'AZURE_TRANSLATOR_KEY' | 'GEMINI_API_KEY' | 'GROQ_API_KEY'>,
): TranslateProvider {
  if (env.TRANSLATE_PROVIDER === 'azure' && env.AZURE_TRANSLATOR_KEY) {
    return new AzureTranslateProvider({ apiKey: env.AZURE_TRANSLATOR_KEY });
  }
  if (env.TRANSLATE_PROVIDER === 'groq' && env.GROQ_API_KEY) {
    return new GroqTranslateProvider({ apiKey: env.GROQ_API_KEY });
  }
  return new GeminiFlashProvider({ apiKey: env.GEMINI_API_KEY ?? '' });
}

export async function registerRelayServer(
  app: FastifyInstance,
  opts: RelayServerOptions,
): Promise<void> {
  const {
    jwtService,
    deepgramApiKey,
    geminiApiKey,
    azureTranslatorKey,
    groqApiKey,
    translateProvider: translateProviderChoice,
    googleCloudTtsKeyFile,
    googleCloudTtsCredentialsJson,
    azureSpeechKey,
    azureSpeechRegion,
    usageTracker,
    backendTtsDisabled,
  } = opts;

  app.get('/ws/translate', { websocket: true }, async (socket: WebSocket, request) => {
    // ── 1. Auth — verify BEFORE accepting any messages ─────────────────────
    const claims = await verifyWsToken(request.raw, jwtService);
    if (claims === null) {
      socket.close(WS_CLOSE_CODES.INVALID_JWT, 'Invalid or missing JWT');
      return;
    }

    const { userId } = claims;
    const sessionId = randomUUID();

    // ── Usage gate — check quota, buffer messages during async check ──────────
    // Message handler is registered immediately to avoid losing frames that arrive
    // during the async gate check. Buffered frames are processed after gate passes
    // or discarded if gate rejects.
    const messageBuffer: Array<{ raw: Buffer | string; isBinary: boolean }> = [];
    let gateResolved = false;

    const bufferingMessageHandler = (raw: Buffer | string, isBinary: boolean): void => {
      if (!gateResolved) {
        messageBuffer.push({ raw, isBinary });
      }
    };
    socket.on('message', bufferingMessageHandler);

    if (usageTracker) {
      const gate = await checkUsageGate(userId, usageTracker);
      if (!gate.allowed) {
        gateResolved = true;
        socket.off('message', bufferingMessageHandler);
        socket.close(WS_CLOSE_CODES.QUOTA_EXCEEDED, 'quota_exceeded');
        return;
      }
    }
    gateResolved = true;
    socket.off('message', bufferingMessageHandler);

    // ── Pipeline providers (instantiated per server, shared across sessions) ─
    const translateProvider = pickTranslateProvider({
      TRANSLATE_PROVIDER: translateProviderChoice ?? 'azure',
      AZURE_TRANSLATOR_KEY: azureTranslatorKey ?? '',
      GEMINI_API_KEY: geminiApiKey ?? '',
      GROQ_API_KEY: groqApiKey ?? '',
    });
    const cloudTts = new GoogleCloudTtsProvider({
      keyFilename: googleCloudTtsKeyFile || undefined,
      credentialsJson: googleCloudTtsCredentialsJson || undefined,
    });
    const ttsProviders: TTSProvider[] = [cloudTts];
    if (azureSpeechKey && azureSpeechRegion) {
      ttsProviders.push(
        new AzureTtsProvider({ apiKey: azureSpeechKey, region: azureSpeechRegion }),
      );
    }
    const ttsProvider = new TtsProviderChain(ttsProviders);

    // ── 2. Enforce one connection per user ──────────────────────────────────
    sessionManager.register(userId, socket);

    emitLifecycleEvent('open', { userId, sessionId });
    app.log.info({ userId, sessionId, event: 'ws.open' }, 'WS connection opened');

    // ── 3. Idle timeout ─────────────────────────────────────────────────────
    let idleTimer = setTimeout(() => {
      socket.close(WS_CLOSE_CODES.IDLE_TIMEOUT, 'Idle timeout');
    }, IDLE_TIMEOUT_MS);

    // ── Mid-stream usage tick — every 60s ────────────────────────────────────
    const usageTickInterval = usageTracker
      ? setInterval(() => {
          usageTracker.tick(userId, 60, 'seconds');
          void (async () => {
            const tier = await usageTracker.getTier(userId);
            const caps = usageTracker.getLimit(tier);
            // Pro — all caps null → unlimited, never close
            if (caps.seconds === null && caps.translateChars === null && caps.ttsChars === null)
              return;
            const used = await usageTracker.getToday(userId);
            const exceeded: string[] = [];
            if (caps.seconds !== null && used.seconds >= caps.seconds) exceeded.push('seconds');
            if (caps.translateChars !== null && used.translateChars >= caps.translateChars)
              exceeded.push('translateChars');
            if (caps.ttsChars !== null && used.ttsChars >= caps.ttsChars) exceeded.push('ttsChars');
            if (exceeded.length > 0) {
              const errFrame: ServerControlFrame = {
                type: 'error',
                code: 'quota_exceeded',
                message: `Daily quota exceeded: ${exceeded.join(', ')}`,
              };
              if (socket.readyState === socket.OPEN) {
                socket.send(JSON.stringify(errFrame));
                socket.close(WS_CLOSE_CODES.QUOTA_EXCEEDED, 'quota_exceeded');
              }
            }
          })();
        }, 60_000)
      : null;

    function resetIdle(): void {
      clearTimeout(idleTimer);
      sessionManager.updateActivity(userId);
      idleTimer = setTimeout(() => {
        socket.close(WS_CLOSE_CODES.IDLE_TIMEOUT, 'Idle timeout');
      }, IDLE_TIMEOUT_MS);
    }

    // ── 4. ASR provider (instantiated per session) ──────────────────────────
    const asr = new DeepgramNova2Provider({ apiKey: deepgramApiKey });
    sessionManager.setAsr(userId, asr);

    // Pipeline orchestrator — created here, srcLang set when config frame arrives
    let orchestrator: PipelineOrchestrator | null = null;

    asr.onTranscript((t) => {
      // ACK backpressure on EVERY response — including empty interims —
      // so the counter recovers during silence. Filtering empty interims
      // here (instead of at the provider) keeps client + orchestrator
      // free of noise while letting BP self-heal.
      bp.frameAcknowledged();

      if (t.text === '' && !t.isFinal) {
        return; // empty interim — heartbeat only, nothing to forward
      }

      const frame: ServerControlFrame = {
        type: 'transcript',
        text: t.text,
        isFinal: t.isFinal,
        ts: t.ts,
      };
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(frame));
      }
      // C3: suppress orchestrator feed while caption frames are flowing —
      // prevents the same segment being translated + billed twice when both
      // ASR audio AND CC subtitles are active in the same WS session.
      if (Date.now() - lastCaptionFrameAt < CAPTION_ACTIVE_WINDOW_MS) {
        return;
      }
      // Feed transcript into the pipeline orchestrator
      orchestrator?.onTranscript(t);
    });

    asr.onError((err) => {
      app.log.warn({ userId, sessionId, err: err.message }, 'ASR error');
      const frame: ServerControlFrame = {
        type: 'error',
        code: 'asr_auth',
        message: err.message,
      };
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(frame));
        socket.close(1011, 'ASR error');
      }
    });

    // ── 5. Backpressure monitor ─────────────────────────────────────────────
    const bp = new BackpressureMonitor({
      // 1000 frames = 100s buffer. Deepgram only sends Metadata sporadically
      // (5-15s between messages), so our app-level BP counter — which only
      // ACKs on incoming messages — saturated at 100 in <10s of continuous
      // audio, causing Deepgram to idle-close 1011 ("did not receive audio
      // within timeout window"). Deepgram has its own WS buffering; our BP
      // is mostly belt-and-suspenders. 1000 effectively never trips for
      // real speech but still catches a fully-stalled Deepgram (100s+).
      maxFramesInFlight: 1000,
      onBackpressure: () => {
        const frame: ServerControlFrame = {
          type: 'warning',
          code: 'backpressure',
          message: 'Audio frames dropped due to backpressure',
        };
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(frame));
        }
        app.log.warn({ userId, sessionId }, 'Backpressure: dropping audio frame');
      },
    });

    let asrStarted = false;
    let audioDroppedBeforeConfig = 0;
    // Captured from the most recent config frame so `flush` restarts ASR
    // with the user's chosen language, not a default.
    let currentSrcLang: string = 'en';
    // C3 defense: when a caption frame arrives within the last 5s, the CC
    // path is considered active and ASR transcripts are suppressed to
    // prevent the orchestrator from translating the same segment twice.
    let lastCaptionFrameAt = 0;
    const CAPTION_ACTIVE_WINDOW_MS = 5000;

    // ── 6. Message handler ──────────────────────────────────────────────────
    let _firstMsgLogged = false;
    socket.on('message', (raw, isBinary) => {
      resetIdle();

      if (!_firstMsgLogged) {
        _firstMsgLogged = true;
        console.info(
          `[relay] first message received (isBinary=${isBinary}, size=${Buffer.isBuffer(raw) ? raw.length : -1})`,
        );
      }

      let parsed;
      try {
        parsed = parseFrame(isBinary ? (raw as Buffer) : raw.toString());
      } catch (err) {
        console.warn(
          `[relay] parseFrame failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        const frame: ServerControlFrame = {
          type: 'error',
          code: 'invalid_frame',
          message: err instanceof Error ? err.message : 'Invalid frame',
        };
        socket.send(JSON.stringify(frame));
        return;
      }

      if (parsed.kind === 'audio') {
        if (!asrStarted) {
          // Audio arrived before config — count drops so we know when the
          // session is misordered (extension forgot to send config first).
          audioDroppedBeforeConfig++;
          if (audioDroppedBeforeConfig === 1 || audioDroppedBeforeConfig % 50 === 0) {
            app.log.warn(
              { userId, sessionId, dropped: audioDroppedBeforeConfig },
              'audio frame dropped — asrStarted=false (no config frame yet?)',
            );
          }
          return;
        }
        if (bp.shouldDrop()) {
          // Drop frame — warning already sent by onBackpressure callback
          return;
        }
        bp.frameSent();
        asr.sendAudio(parsed.pcm);
        return;
      }

      // ── Control frame ───────────────────────────────────────────────────
      const { frame } = parsed;

      if (frame.type === 'config') {
        const { srcLang, targetLang = 'vi' } = frame;
        app.log.info(
          { userId, sessionId, srcLang, targetLang, droppedBeforeConfig: audioDroppedBeforeConfig },
          'config frame received',
        );
        if (!(ALLOWED_SRC_LANGS as readonly string[]).includes(srcLang)) {
          app.log.warn(
            { userId, sessionId, srcLang, allowed: ALLOWED_SRC_LANGS.join(',') },
            'config rejected — invalid srcLang',
          );
          const errFrame: ServerControlFrame = {
            type: 'error',
            code: 'invalid_src_lang',
            message: `srcLang '${srcLang}' is not supported. Allowed: ${ALLOWED_SRC_LANGS.join(', ')}`,
          };
          socket.send(JSON.stringify(errFrame));
          return;
        }

        currentSrcLang = srcLang;

        // Defer asrStarted=true until Deepgram socket is actually OPEN.
        // Setting it true before start() resolves caused audio frames to be
        // forwarded to a CONNECTING socket → SDK threw "Socket is not open"
        // → unhandled exception crashed the relay process.
        void asr
          .start({ srcLang, sampleRate: 16000 })
          .then(() => {
            asrStarted = true;
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            app.log.error({ userId, sessionId, err: msg }, 'ASR start failed');
            // I2: notify client + close the socket so the UI exits the
            // "capturing" state instead of stalling forever.
            if (socket.readyState === socket.OPEN) {
              const errFrame: ServerControlFrame = {
                type: 'error',
                code: 'asr_start_failed',
                message: msg,
              };
              socket.send(JSON.stringify(errFrame));
              socket.close(1011, 'asr_start_failed');
            }
          });

        // Instantiate per-session pipeline orchestrator
        orchestrator?.destroy();
        orchestrator = new PipelineOrchestrator({
          socket,
          translateProvider,
          ttsProvider,
          srcLang,
          targetLang,
          ttsDisabled: backendTtsDisabled === true,
          onTranslateComplete: usageTracker
            ? (chars) => {
                usageTracker.tick(userId, chars, 'translateChars');
              }
            : undefined,
          onTtsComplete: usageTracker
            ? (chars) => {
                usageTracker.tick(userId, chars, 'ttsChars');
              }
            : undefined,
        });

        app.log.info({ userId, sessionId, srcLang }, 'ASR session started');
        return;
      }

      if (frame.type === 'pause') {
        // No-op for MVP — future: pause forwarding
        return;
      }

      if (frame.type === 'resume') {
        // No-op for MVP — future: resume forwarding
        return;
      }

      if (frame.type === 'flush') {
        // Finalize current ASR segment: stop + restart with the user's
        // chosen source language (captured at config-frame time).
        void asr.stop().then(async () => {
          if (asrStarted && sessionManager.hasSession(userId)) {
            await asr.start({ srcLang: currentSrcLang, sampleRate: 16000 });
            bp.reset();
          }
        });
        return;
      }

      if (frame.type === 'caption') {
        // Subtitle-first path: bypass ASR, push text directly to orchestrator.
        // No bp.frameSent() — this is not an audio chunk.
        lastCaptionFrameAt = Date.now(); // C3: arm ASR-forward suppression
        app.log.info({ userId, sessionId, ts: frame.ts }, 'caption frame received');
        orchestrator?.onTranscript({
          text: frame.text,
          isFinal: frame.isFinal,
          ts: frame.ts,
        });
        return;
      }
    });

    // ── Drain buffered messages collected during gate check ────────────────────
    for (const { raw, isBinary } of messageBuffer) {
      socket.emit('message', raw, isBinary);
    }
    messageBuffer.length = 0;

    // ── 7. Close handler ────────────────────────────────────────────────────
    socket.on('close', () => {
      clearTimeout(idleTimer);
      if (usageTickInterval) clearInterval(usageTickInterval);
      // Pass socket reference so delete only removes our entry, not a newer connection's
      sessionManager.delete(userId, socket);
      void asr.stop();
      orchestrator?.destroy();
      orchestrator = null;
      emitLifecycleEvent('close', { userId, sessionId });
      app.log.info({ userId, sessionId, event: 'ws.close' }, 'WS connection closed');
    });

    socket.on('error', (err) => {
      app.log.error({ userId, sessionId, err: err.message, event: 'ws.error' }, 'WS error');
      emitLifecycleEvent('error', { userId, sessionId });
    });
  });
}
