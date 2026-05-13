#!/usr/bin/env node
/**
 * Validates .env at project root against the keys required by backend.
 *
 * Usage:
 *   node scripts/check-env.cjs
 *
 * Exits 0 if ready to boot, 1 if any required key is missing/placeholder.
 * Prints a tickbox list so users can see exactly what's left to do.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const REQUIRED = [
  { key: 'MONGO_URI', service: 'MongoDB Atlas (Step 2.1)', test: (v) => v.startsWith('mongodb') },
  { key: 'JWT_SECRET', service: 'Generated locally (Step 3)', test: (v) => v.length >= 32 },
  { key: 'DEEPGRAM_API_KEY', service: 'Deepgram (Step 2.2)', test: (v) => v.length >= 20 },
  { key: 'GEMINI_API_KEY', service: 'Gemini (Step 2.4)', test: (v) => v.startsWith('AIza') },
  { key: 'GOOGLE_CLOUD_TTS_KEY_FILE', service: 'GCP TTS JSON (Step 2.3.b)', test: (v) => {
      const abs = path.isAbsolute(v) ? v : path.join(ROOT, 'backend', v);
      return fs.existsSync(abs);
    } },
  { key: 'GOOGLE_OAUTH_CLIENT_ID', service: 'GCP OAuth (Step 2.3.c)', test: (v) => v.endsWith('.apps.googleusercontent.com') },
  { key: 'GOOGLE_OAUTH_CLIENT_SECRET', service: 'GCP OAuth (Step 2.3.c)', test: (v) => v.length >= 20 },
  { key: 'RESEND_API_KEY', service: 'Resend (Step 2.5)', test: (v) => v.startsWith('re_') },
  { key: 'EMAIL_FROM', service: 'Resend (Step 2.5)', test: (v) => v.includes('@') },
  { key: 'POLAR_API_KEY', service: 'Polar.sh (Step 2.6)', test: (v) => v.startsWith('polar_') },
  { key: 'POLAR_WEBHOOK_SECRET', service: 'Polar.sh webhook (Step 2.6)', test: (v) => v.length >= 32 },
  { key: 'POLAR_PRODUCT_ID_PRO', service: 'Polar.sh product (Step 2.6)', test: (v) => v.length >= 8 },
];

const OPTIONAL = [
  { key: 'ALLOWED_EXTENSION_IDS', service: 'Extension ID (Step 5)', note: 'Set after first extension load' },
  { key: 'PORT', service: 'Backend port (default 3000)', note: 'Match extension WXT_WS_URL' },
  { key: 'NODE_ENV', service: 'Environment', note: 'development | production' },
];

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.log(`${RED}✗${RESET} ${ENV_PATH} does not exist.\n`);
    console.log(`Run: ${BLUE}cp .env.example .env${RESET}`);
    process.exit(1);
  }
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

function isPlaceholder(v) {
  if (!v) return true;
  const lc = v.toLowerCase();
  return lc === 'placeholder' || lc === 'todo' || lc === 'tbd' || lc === 'xxx' || lc.includes('your_') || lc.includes('your-');
}

function main() {
  console.log(`${BLUE}Checking .env...${RESET}\n`);
  const env = loadEnv();

  let done = 0;
  let missing = 0;
  const todo = [];

  for (const r of REQUIRED) {
    const v = env[r.key] || '';
    if (!v) {
      console.log(`${RED}✗${RESET}  ${r.key}  ${DIM}— ${r.service}${RESET}  ${RED}[empty]${RESET}`);
      todo.push({ key: r.key, service: r.service, reason: 'empty' });
      missing++;
    } else if (isPlaceholder(v)) {
      console.log(`${RED}✗${RESET}  ${r.key}  ${DIM}— ${r.service}${RESET}  ${RED}[placeholder]${RESET}`);
      todo.push({ key: r.key, service: r.service, reason: 'placeholder' });
      missing++;
    } else if (!r.test(v)) {
      console.log(`${YELLOW}!${RESET}  ${r.key}  ${DIM}— ${r.service}${RESET}  ${YELLOW}[invalid format]${RESET}`);
      todo.push({ key: r.key, service: r.service, reason: 'invalid format' });
      missing++;
    } else {
      console.log(`${GREEN}✓${RESET}  ${r.key}  ${DIM}— ${r.service}${RESET}`);
      done++;
    }
  }

  console.log(`\n${DIM}Optional:${RESET}`);
  for (const o of OPTIONAL) {
    const v = env[o.key] || '';
    if (v && !isPlaceholder(v)) {
      console.log(`${GREEN}✓${RESET}  ${o.key} = ${v}  ${DIM}(${o.note})${RESET}`);
    } else {
      console.log(`${DIM}-  ${o.key}  ${o.note}${RESET}`);
    }
  }

  console.log(`\n${BLUE}Summary:${RESET} ${GREEN}${done} ready${RESET} / ${RED}${missing} missing${RESET}\n`);

  if (missing > 0) {
    console.log(`${YELLOW}Next:${RESET}`);
    for (const t of todo) {
      console.log(`  - ${t.key} — ${t.service} (${t.reason})`);
    }
    console.log(`\nSee ${BLUE}docs/deployment-guide.md${RESET} Section 2 for step-by-step provisioning.\n`);
    process.exit(1);
  }

  // All required keys present — extra sanity checks
  const port = env.PORT || '3000';
  console.log(`${GREEN}Ready to boot backend.${RESET}`);
  console.log(`  Backend will listen on port ${BLUE}${port}${RESET}`);
  console.log(`  Make sure extension WXT_WS_URL matches: ${BLUE}ws://localhost:${port}/ws/translate${RESET}`);
  console.log(`\nRun: ${BLUE}pnpm dev:backend${RESET}\n`);
  process.exit(0);
}

main();
