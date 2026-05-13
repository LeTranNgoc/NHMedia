#!/usr/bin/env node
/**
 * Downloads Silero VAD ONNX model to extension/public/vad/silero-vad.onnx
 *
 * Source: https://github.com/snakers4/silero-vad (MIT licensed)
 * Pinned to a known-good commit so we don't drift on every model update.
 *
 * Verifies sha256 after download. Skips if file already exists and hash matches.
 *
 * Usage:
 *   node scripts/download-vad-model.cjs
 *   pnpm vad:download
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(ROOT, 'extension', 'public', 'vad');
const TARGET_FILE = path.join(TARGET_DIR, 'silero-vad.onnx');

// Pinned to silero-vad v5.1.2 release asset (Sep 2024 — stable, widely deployed)
const URL = 'https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx';

// Expected sha256 of v5.1.2 silero_vad.onnx (~2.2MB)
// Captured 2026-05-13 from upstream commit pinned in URL.
const EXPECTED_SHA256 = '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function hashFile(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function followRedirect(url, depth = 0) {
  if (depth > 5) throw new Error('Too many redirects');
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const next = res.headers.location;
        if (!next) return reject(new Error(`Redirect with no Location header`));
        res.resume();
        followRedirect(next, depth + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function main() {
  console.log(`${BLUE}Silero VAD downloader${RESET}\n`);

  // Ensure target dir
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
    console.log(`${GREEN}✓${RESET} Created ${path.relative(ROOT, TARGET_DIR)}`);
  }

  // Skip if file exists + hash matches (or no hash configured)
  if (fs.existsSync(TARGET_FILE)) {
    const size = fs.statSync(TARGET_FILE).size;
    console.log(`${DIM}Existing file: ${size} bytes${RESET}`);
    if (size < 1_000_000) {
      console.log(`${YELLOW}!${RESET} File too small (<1MB) — probably the LICENSE placeholder. Will overwrite.`);
    } else if (EXPECTED_SHA256) {
      const hash = hashFile(TARGET_FILE);
      if (hash === EXPECTED_SHA256) {
        console.log(`${GREEN}✓${RESET} Already downloaded + verified (${hash.slice(0, 12)}...)`);
        return;
      }
      console.log(`${YELLOW}!${RESET} Hash mismatch — re-downloading`);
    } else {
      console.log(`${GREEN}✓${RESET} Already downloaded (verification skipped — no EXPECTED_SHA256 set)`);
      return;
    }
  }

  // Download
  console.log(`${BLUE}→${RESET} GET ${URL}`);
  const res = await followRedirect(URL);
  const total = parseInt(res.headers['content-length'] || '0', 10);
  console.log(`${DIM}Size: ${total ? Math.round(total / 1024) + ' KB' : 'unknown'}${RESET}`);

  const tmpFile = TARGET_FILE + '.tmp';
  const out = fs.createWriteStream(tmpFile);
  let received = 0;
  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => { received += chunk.length; });
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });

  const finalSize = fs.statSync(tmpFile).size;
  if (finalSize < 1_000_000) {
    fs.unlinkSync(tmpFile);
    throw new Error(`Downloaded file too small (${finalSize} bytes) — probably an error response`);
  }

  // Verify (if hash configured)
  const hash = hashFile(tmpFile);
  if (EXPECTED_SHA256 && hash !== EXPECTED_SHA256) {
    fs.unlinkSync(tmpFile);
    throw new Error(`sha256 mismatch:\n  expected: ${EXPECTED_SHA256}\n  got:      ${hash}`);
  }

  fs.renameSync(tmpFile, TARGET_FILE);
  console.log(`${GREEN}✓${RESET} Saved to ${path.relative(ROOT, TARGET_FILE)}`);
  console.log(`${DIM}  sha256: ${hash}${RESET}`);
  if (!EXPECTED_SHA256) {
    console.log(`${YELLOW}TIP:${RESET} Pin this hash in scripts/download-vad-model.cjs EXPECTED_SHA256 for future integrity checks.`);
  }
  console.log(`\n${BLUE}Next:${RESET} Rebuild extension to include the model:\n  ${BLUE}pnpm -F extension build${RESET}`);
}

main().catch((err) => {
  console.error(`${RED}✗${RESET} ${err.message}`);
  process.exit(1);
});
