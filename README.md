# Translate Voice

Chrome MV3 extension for real-time Vietnamese voice-over on YouTube videos.

Pipeline: tabCapture → Deepgram Nova-2 (ASR) → Gemini Flash 2.0 (translate) → Google Cloud TTS Neural2 (Vietnamese voice) → AudioContext playback with ducking. Latency target ~1s.

## Workspace layout

| Package | Purpose |
|---|---|
| `extension/` | Chrome MV3 extension (wxt + React + Tailwind) |
| `backend/` | Node.js + Fastify WS relay, auth, billing |
| `shared/` | Shared types (WS protocol, settings schema, billing types) |

## Prerequisites

- Node.js >= 20
- pnpm >= 10
- MongoDB (local or Atlas free tier)
- Service account JSON for Google Cloud TTS
- API keys: Deepgram, Gemini, Resend, Polar.sh

## Setup

```bash
pnpm install
cp .env.example .env       # fill in keys
pnpm typecheck             # verify tsconfig
pnpm test                  # smoke tests
```

## Dev

```bash
pnpm dev:backend           # Fastify server on :3000
pnpm dev:extension         # wxt dev — load extension/.output/chrome-mv3/ in Chrome
```

## Build

```bash
pnpm build                 # build all packages
pnpm -F extension build    # extension only
pnpm -F backend build      # backend only
```

## Test

```bash
pnpm test                  # run all package tests
pnpm -F backend test       # backend tests only
```

## Architecture

See `plans/260513-0027-translate-voice-extension/plan.md` for the full phased plan.

## Status

MVP in progress. Target: YouTube only, free 15min/day + Pro unlimited via Polar.sh.
