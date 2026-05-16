#!/usr/bin/env node
/**
 * Launch Chrome with the built extension auto-loaded into a throwaway profile.
 *
 * Why throwaway profile (`--user-data-dir`):
 *   - Doesn't pollute the user's daily Chrome profile.
 *   - Each launch starts clean — no leftover storage from previous runs that
 *     could mask "first install" bugs (e.g. settings defaults, OAuth flow).
 *   - The dir is created next to the extension build output and removed when
 *     `--keep-profile` is NOT passed.
 *
 * Auto-rebuild:
 *   - If `.output/chrome-mv3/manifest.json` is missing OR older than any file
 *     in `extension/src` / `entrypoints`, rebuild before launch. Pass
 *     `--no-build` to skip that check.
 *
 * Backend wiring:
 *   - Defaults `WXT_API_BASE=http://localhost:3000` + `WXT_WS_URL=ws://localhost:3000/ws/translate`.
 *   - Override via flags: `--api=https://...` and `--ws=wss://...`. These are
 *     applied to the build environment so the bundled extension talks to the
 *     right host.
 *
 * Usage:
 *   node scripts/launch-extension-chrome.cjs
 *   node scripts/launch-extension-chrome.cjs --url=https://www.youtube.com/watch?v=jNQXAC9IVRw
 *   node scripts/launch-extension-chrome.cjs --api=https://translate-voice-backend.fly.dev --ws=wss://translate-voice-backend.fly.dev/ws/translate
 *   node scripts/launch-extension-chrome.cjs --no-build --keep-profile
 *
 * Or via pnpm:
 *   pnpm chrome:extension
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const BUILD_DIR = path.join(EXT_DIR, '.output', 'chrome-mv3');
const PROFILE_DIR = path.join(os.tmpdir(), 'tv-chrome-ext-profile');

// ── ANSI ──────────────────────────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ── Args ──────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const OPEN_URL = args.url || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const API_BASE = args.api || 'http://localhost:3000';
const WS_URL = args.ws || 'ws://localhost:3000/ws/translate';
const SHOULD_BUILD = args['no-build'] !== true;
const KEEP_PROFILE = args['keep-profile'] === true;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? true;
    }
  }
  return out;
}

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`${BLUE}[chrome-launcher]${RESET} ${msg}`);
}
function warn(msg) {
  console.log(`${YELLOW}[chrome-launcher]${RESET} ${msg}`);
}
function fail(msg) {
  console.error(`${RED}[chrome-launcher]${RESET} ${msg}`);
  process.exit(1);
}

// ── Chrome detection ──────────────────────────────────────────────────────────
function findChrome() {
  const platform = process.platform;
  const candidates = [];

  if (platform === 'win32') {
    const programFiles = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env['LOCALAPPDATA'],
    ].filter(Boolean);
    for (const root of programFiles) {
      candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    // Linux — rely on PATH
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const which = spawnSync('which', [bin], { encoding: 'utf8' });
      if (which.status === 0) candidates.push(which.stdout.trim());
    }
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// ── Build freshness check ─────────────────────────────────────────────────────
function manifestExists() {
  return fs.existsSync(path.join(BUILD_DIR, 'manifest.json'));
}

function sourcesNewerThanBuild() {
  if (!manifestExists()) return true;
  const manifestMtime = fs.statSync(path.join(BUILD_DIR, 'manifest.json')).mtimeMs;
  const watched = [path.join(EXT_DIR, 'src'), path.join(EXT_DIR, 'entrypoints')];
  for (const root of watched) {
    if (!fs.existsSync(root)) continue;
    if (walkNewerThan(root, manifestMtime)) return true;
  }
  return false;
}

function walkNewerThan(dir, threshold) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const stat = fs.statSync(full);
    if (stat.mtimeMs > threshold) return true;
    if (entry.isDirectory() && walkNewerThan(full, threshold)) return true;
  }
  return false;
}

// ── Build ─────────────────────────────────────────────────────────────────────
function build() {
  log(`Building extension (WXT_API_BASE=${API_BASE})...`);
  const env = {
    ...process.env,
    WXT_API_BASE: API_BASE,
    WXT_WS_URL: WS_URL,
  };
  // Windows .cmd files require shell:true via Node spawn — without it, spawn
  // returns ENOENT or exit-1 without running the build. shell:true also picks
  // up pnpm from PATH on POSIX.
  const r = spawnSync('pnpm', ['-F', 'extension', 'build'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) fail('Extension build failed.');
}

// ── Profile mgmt ──────────────────────────────────────────────────────────────
function prepareProfile() {
  if (fs.existsSync(PROFILE_DIR) && !KEEP_PROFILE) {
    log(`Clearing previous profile at ${DIM}${PROFILE_DIR}${RESET}`);
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

// ── Launch ────────────────────────────────────────────────────────────────────
function launch(chromePath) {
  const args = [
    `--load-extension=${BUILD_DIR}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Audio capture needs explicit permission flag in some Chrome versions
    '--enable-features=WebContentsForceDark=disabled',
    OPEN_URL,
  ];

  log(`Launching ${path.basename(chromePath)}`);
  log(`  Extension: ${DIM}${BUILD_DIR}${RESET}`);
  log(`  Profile:   ${DIM}${PROFILE_DIR}${RESET}${KEEP_PROFILE ? ' (kept)' : ' (cleared on next run)'}`);
  log(`  URL:       ${DIM}${OPEN_URL}${RESET}`);
  log('');
  log(`Tips:`);
  log(`  - Extension ID hiện ở ${DIM}chrome://extensions${RESET} (cần cho ALLOWED_EXTENSION_IDS).`);
  log(`  - Service worker: chrome://extensions → click "service worker" để mở DevTools.`);
  log(`  - Đóng Chrome window để kết thúc (Ctrl+C tại đây cũng hoạt động).`);

  const child = spawn(chromePath, args, {
    stdio: 'ignore',
    detached: false,
  });

  child.on('exit', (code) => {
    log(`Chrome exited (code ${code ?? 0}).`);
    process.exit(0);
  });

  // Forward Ctrl+C → kill chrome
  process.on('SIGINT', () => {
    log('SIGINT — closing Chrome...');
    child.kill();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  log(`${GREEN}Translate Voice — Chrome launcher${RESET}`);

  const chrome = findChrome();
  if (!chrome) {
    fail(
      'Chrome / Edge / Chromium không tìm thấy trên hệ thống.\n' +
        '  Cài Chrome: https://www.google.com/chrome/\n' +
        '  Hoặc set env CHROME_PATH trỏ đến binary.',
    );
  }

  if (SHOULD_BUILD && (sourcesNewerThanBuild() || !manifestExists())) {
    build();
  } else {
    log(`Build skipped — ${manifestExists() ? 'up to date' : 'no manifest, but --no-build passed'}.`);
  }

  if (!manifestExists()) {
    fail(`No manifest at ${BUILD_DIR}. Run without --no-build to trigger a build.`);
  }

  prepareProfile();
  launch(process.env['CHROME_PATH'] || chrome);
}

main();
