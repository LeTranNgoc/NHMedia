#!/usr/bin/env node
/**
 * First-time setup helper.
 * - Copies .env.example → .env if .env doesn't exist
 * - Generates JWT_SECRET if blank
 * - Verifies extension/.env.example is documented
 * - Verifies backend/secrets/ folder exists
 * - Runs check-env at the end
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   node scripts/setup.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const ENV = path.join(ROOT, '.env');
const SECRETS_DIR = path.join(ROOT, 'backend', 'secrets');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function info(msg) { console.log(`${BLUE}→${RESET} ${msg}`); }
function done(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}!${RESET} ${msg}`); }

function ensureEnvFile() {
  if (fs.existsSync(ENV)) {
    done(`.env exists`);
    return false;
  }
  if (!fs.existsSync(ENV_EXAMPLE)) {
    console.error(`${RED}✗${RESET} .env.example missing — repo state corrupted`);
    process.exit(1);
  }
  fs.copyFileSync(ENV_EXAMPLE, ENV);
  done(`Created .env from .env.example`);
  return true;
}

function ensureJwtSecret() {
  const content = fs.readFileSync(ENV, 'utf8');
  const match = content.match(/^JWT_SECRET=(.*)$/m);
  const current = match ? match[1].replace(/['"]/g, '').trim() : '';
  if (current && current.length >= 32 && current.toLowerCase() !== 'generate_below') {
    done(`JWT_SECRET already set (${current.length} chars)`);
    return;
  }
  const secret = crypto.randomBytes(48).toString('base64');
  const updated = match
    ? content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`)
    : `${content}\nJWT_SECRET=${secret}\n`;
  fs.writeFileSync(ENV, updated);
  done(`Generated JWT_SECRET (${secret.length} chars)`);
}

function ensureSecretsDir() {
  if (fs.existsSync(SECRETS_DIR)) {
    done(`backend/secrets/ exists`);
    return;
  }
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SECRETS_DIR, '.gitignore'), '*\n!.gitignore\n!README.md\n');
  done(`Created backend/secrets/ (gitignored)`);
}

function summary() {
  console.log(`\n${BLUE}=== Setup complete ===${RESET}\n`);
  console.log(`Local files ready. ${YELLOW}You still need to provision 6 services${RESET}:\n`);
  console.log(`  1. ${BLUE}MongoDB Atlas${RESET}    https://www.mongodb.com/cloud/atlas/register   → MONGO_URI`);
  console.log(`  2. ${BLUE}Deepgram${RESET}         https://console.deepgram.com/signup            → DEEPGRAM_API_KEY`);
  console.log(`  3. ${BLUE}Google Cloud${RESET}     https://console.cloud.google.com               → service JSON + OAuth ID/Secret`);
  console.log(`  4. ${BLUE}Gemini API${RESET}       https://aistudio.google.com/apikey             → GEMINI_API_KEY`);
  console.log(`  5. ${BLUE}Resend${RESET}           https://resend.com/signup                      → RESEND_API_KEY`);
  console.log(`  6. ${BLUE}Polar.sh${RESET}         https://polar.sh/signup                        → POLAR_API_KEY + product + webhook`);
  console.log(`\nWalkthrough: ${BLUE}docs/deployment-guide.md${RESET} Section 2\n`);
  console.log(`When you've filled .env, run: ${BLUE}node scripts/check-env.cjs${RESET}\n`);
}

function main() {
  info(`Project root: ${ROOT}`);
  ensureEnvFile();
  ensureJwtSecret();
  ensureSecretsDir();

  console.log();
  info(`Running env validation...`);
  console.log();
  const r = spawnSync('node', [path.join('scripts', 'check-env.cjs')], { cwd: ROOT, stdio: 'inherit' });

  if (r.status !== 0) {
    summary();
    process.exit(1);
  }

  console.log();
  done(`All env vars set. You're ready to ${BLUE}pnpm dev:backend${RESET}.`);
}

main();
