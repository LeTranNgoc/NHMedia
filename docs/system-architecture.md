# System Architecture

> **Audience:** any engineer (human or agent) about to touch backend WS layer, extension audio pipeline, or Chrome MV3 messaging. Read this before debugging "why doesn't my message arrive."

## Three-context Chrome MV3 model

The extension is split across **three isolated JavaScript contexts** that cannot share memory and communicate ONLY via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Popup (React, ephemeral — dies when closed)                          │
│   ├─ MainView, SettingsView, AccountView                             │
│   ├─ useSettings() hook → chrome.storage.sync                        │
│   └─ billingApiClient → fetch /billing/*                             │
│                                                                      │
│        │ chrome.runtime.sendMessage                                  │
│        ▼                                                             │
│ Service Worker (background.ts — terminated after 30s idle)           │
│   ├─ MessageRouter: routes msg.type across contexts                  │
│   ├─ OffscreenManager: ensureCreated() / sendToOffscreen()           │
│   └─ TabCaptureHandler: chrome.tabCapture.getMediaStreamId           │
│                                                                      │
│        │ chrome.runtime.sendMessage  (offscreen pings SW every 5s    │
│        ▼                              → keeps SW alive)              │
│ Offscreen Document (USER_MEDIA reason — persistent, no 30s timeout)  │
│   ├─ AudioPipelineController: lifecycle orchestrator                 │
│   ├─ AudioCapture: getUserMedia(chromeMediaSource: 'tab', streamId)  │
│   ├─ AudioWorkletNode → downsample-processor.js (48k→16k Int16 PCM)  │
│   ├─ RingBuffer (SharedArrayBuffer 256KB)                            │
│   ├─ SileroVAD (ONNX runtime, fallback "send-all" if model missing)  │
│   ├─ WSClient: wss://api/.../ws/translate?token=<JWT>&srcLang=<lang> │
│   ├─ WSReceiver: routes inbound frames                               │
│   │     ├─ {type:'audio'}       → AudioPlaybackQueue.enqueue         │
│   │     └─ {type:'transcript'   → chrome.runtime.sendMessage         │
│   │        | 'translation'}        (relay to popup + content)        │
│   └─ AudioPlaybackQueue: base64 MP3 → decodeAudioData → AudioContext │
│                                                                      │
│        │ chrome.tabs.sendMessage (SW → content)                      │
│        ▼                                                             │
│ Content Script (youtube.content.ts — runs in YouTube tab DOM)        │
│   ├─ VideoController: MutationObserver finds <video>,                │
│   │     hooks pause/play/seeking/seeked/ratechange/ended              │
│   ├─ DuckingManager: video.volume / video.muted                      │
│   ├─ SubtitleOverlay: bottom-of-page div, textContent (XSS-safe)     │
│   ├─ StatusBadge: top-right badge, click-toggle                      │
│   └─ Sends content.video.event back to SW                            │
└──────────────────────────────────────────────────────────────────────┘
```

### Why three contexts, not one

- **Popup dies when closed.** Cannot host long-running audio capture.
- **Service Worker terminates after 30s idle.** Cannot capture audio reliably.
- **Content Script lives in the YouTube page sandbox.** Can read/write DOM but has limited Chrome API surface.

→ **Offscreen Document** is the only context with: persistent lifecycle (with `USER_MEDIA` reason), Web Audio API access, and getUserMedia for tab audio capture. It's mandatory for our use case.

### Critical lifecycle gotchas

1. **Offscreen reason MUST be `USER_MEDIA`** (not `AUDIO_PLAYBACK`). USER_MEDIA does NOT have a 30s timeout. Defined in `extension/src/background/offscreen-manager.ts`.

2. **Service Worker keepalive.** Offscreen sends `{type:'offscreen.ping'}` every 5s via `chrome.runtime.sendMessage` back to SW. The act of *receiving* a message resets the SW's 30s idle timer. Verified pattern for Chrome 109+.

3. **`chrome.tabCapture.getMediaStreamId` requires a user gesture in the initiating context.** Popup click → SW → offscreen is the supported flow. Content-script-initiated is fragile (status badge click currently invokes this path via content → SW → tabCapture — flagged as risky in review).

4. **SW restart loses in-memory state.** If Chrome power-saves or OOM-kills the SW, it restarts cold. The offscreen pipeline keeps running but the SW's `activeTabId`, `currentStatus`, etc. are gone. Persist anything load-bearing to `chrome.storage.session` (cleared on browser restart but survives SW restart).

## Audio capture flow (end-to-end)

```
User clicks "Start" in popup
   │ chrome.runtime.sendMessage({type:'popup.start', tabId})
   ▼
SW: TabCaptureHandler.startCapture(tabId)
   │ verify host is youtube.com
   │ ensureOffscreenCreated()
   │ const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId})
   │ chrome.runtime.sendMessage({type:'audio.start', streamId, config: {srcLang, wsUrl, jwt}})
   ▼
Offscreen: AudioPipelineController.start(config)
   │ await VAD.load()        ← may fall back to "send-all" mode if ONNX missing
   │ await WSClient.connect(wsUrl, jwt, srcLang)
   │ await AudioCapture.start(streamId)
   │     │ navigator.mediaDevices.getUserMedia({audio:{
   │     │   mandatory:{ chromeMediaSource:'tab', chromeMediaSourceId:streamId }
   │     │ }})
   │     │ → MediaStream
   │     ▼
   │   new AudioContext({sampleRate:48000})
   │   .createMediaStreamSource(stream)
   │   .connect(new AudioWorkletNode(ctx, 'downsample-processor'))
   │     │ ── worklet thread (vanilla JS, no imports) ───
   │     │ 48kHz stereo Float32 → avg L+R → linear-interp 16kHz mono
   │     │ → clip to Int16 ×32767
   │     │ → Atomics write to SharedArrayBuffer ring
   │     ──────────────────────────────────────────────
   │ start 100ms tick:
   │   buf = ringBuffer.read(3200)   ← 100ms @ 16kHz Int16 mono
   │   isSpeech = await vad.isSpeech(buf)
   │   if isSpeech → wsClient.sendAudio(buf)   ← binary frame
   ▼
Backend WS: /ws/translate?token=<JWT>&srcLang=<lang>
   │ AuthHandshake.verifyJWT (BEFORE upgrade)
   │ UsageGate.check (Phase 08 — quota_exceeded → close 4003)
   │ SessionManager.register (kick prior session 4002)
   │ → Deepgram Nova-2 streaming (interim_results=true)
   │ → PipelineOrchestrator subscribes transcript events
   │     ├─ TranscriptDebouncer (300ms / isFinal)
   │     ├─ SentenceChunker (split on punctuation)
   │     ├─ TranslationCache (LRU)
   │     ├─ Gemini Flash 2.0 → Vietnamese text
   │     └─ Google Cloud TTS Neural2 vi-VN → MP3
   │ ws.send {type:'translation', text}   ← for subtitle
   │ ws.send {type:'audio', data: base64 MP3}
   ▼
Offscreen: WSReceiver routes inbound frames
   │ audio → AudioPlaybackQueue.enqueue
   │     │ base64 → ArrayBuffer → ctx.decodeAudioData → AudioBufferSourceNode
   │     │ source.start(nextScheduledTime); nextScheduledTime += duration
   │     │ stall >500ms → reset to ctx.currentTime
   │ transcript/translation → chrome.runtime.sendMessage to SW
   ▼
SW: MessageRouter forwards translation to active YouTube tab
   ▼
Content Script: SubtitleOverlay.show(text)
   │ textContent (not innerHTML — XSS-safe)
   │ auto-clear after 5s
   │ DuckingManager.applyVoiceOver(percent) — modulates video.volume
```

## JWT plumbing requirements (CRITICAL)

The JWT lives in 3 places at once and MUST flow correctly between them:

| Where | Who writes | Who reads |
|---|---|---|
| `chrome.storage.local` (key: `authToken`) | post-login flow (TBD — currently no sign-in UX) | popup AccountView (via `billingApiClient.getMe()`), SW WS handshake handler |
| `Authorization: Bearer <jwt>` header | popup `billingApiClient` fetch | backend `AuthGuard` middleware |
| `?token=<jwt>` query string on WS URL | SW `PipelineConfig` builder | backend `auth-handshake.ts` |

**Common failure mode (caught in MVP review):** SW hard-codes `jwt: ''` in `PipelineConfig`. Extension cannot authenticate. Backend rejects with 4001. Symptoms: popup shows error after a few seconds, WS reconnect loops fatally.

**Fix pattern:** SW's `popup.start` handler MUST read `await chrome.storage.local.get('authToken')` and inject into PipelineConfig BEFORE forwarding to offscreen.

## Backend domain layers

```
backend/src/
├── main.ts                   ← boot: loadEnv → connectMongo → buildApp → listen
├── app.ts                    ← Fastify factory: CORS, raw-body parser, routes, error handler
├── config/env.ts             ← zod-validated env loader (MUST fail-fast on missing prod secrets)
├── db/
│   ├── mongo-client.ts       ← singleton + index setup on boot
│   └── models/               ← types + collection helpers
│       ├── user.ts
│       ├── session.ts
│       ├── magic-link-token.ts
│       ├── usage-log.ts      ← {userId, date, secondsCaptured}, TTL 7d
│       └── subscription.ts   ← unique idx polarSubscriptionId
├── auth/                     ← jwt, magic-link, google-oauth, email (Resend)
├── lib/
│   ├── token-hash.ts         ← sha256, never store raw tokens
│   ├── time-constant-compare ← timingSafeEqual wrapper
│   ├── email-rate-limiter.ts ← in-memory per-email limit
│   └── usage-tracker.ts      ← in-memory tick → 30s flush; getTier MUST sort
├── middleware/
│   ├── auth-guard.ts         ← Bearer JWT → req.user
│   ├── error-handler.ts      ← structured {code, message}, no stack leak
│   └── usage-gate-middleware ← WS handshake gate (free 900s/day)
├── ws/                       ← relay-server, auth-handshake, audio-protocol,
│                                session-manager (per-user singleton),
│                                backpressure-monitor, connection-lifecycle
├── providers/
│   ├── asr/{interface, deepgram-nova2-provider}
│   ├── translate/{interface, gemini-flash-provider}
│   └── tts/{interface, google-cloud-tts-provider}
├── pipeline/                 ← orchestrator, debouncer, chunker, cache,
│                                audio-frame-emitter
├── billing/                  ← polar-client, webhook-handler, subscription-service
└── routes/                   ← auth-routes, health-routes, billing-routes
```

## Shared types contract

`shared/src/`:
- `ws-protocol.ts` — `ControlFrame` discriminated union (config/pause/resume/flush/transcript/translation/audio/error), `WS_CLOSE_CODES` constants, `ALLOWED_SRC_LANGS`
- `pipeline-types.ts` — `TranscriptEvent`, `TranslationEvent`, `AudioEvent`
- `billing-types.ts` — `Tier`, `SubscriptionStatus`, `UsageSummary`, `BillingMeResponse`, `CheckoutResponse`
- `index.ts` — re-exports + auth contract types (`User`, `AuthResponse`, `MagicLinkRequest`)

Both backend (Node.js) and extension (browser) import via `@translate-voice/shared` workspace. ESM modules point at `./src/*.ts` directly (per-package `package.json` `"main": "./src/index.ts"`) for monorepo dev experience without a build step.

## Configuration & secrets

`.env.example` lists all env keys. Required for production boot (fail-fast in `config/env.ts` if missing/placeholder):

- `MONGO_URI`, `JWT_SECRET` (≥32 chars), `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_CLOUD_TTS_KEY_FILE`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `RESEND_API_KEY`
- `POLAR_API_KEY`, `POLAR_WEBHOOK_SECRET` (≥32 chars), `POLAR_PRODUCT_ID_PRO`
- `FRONTEND_URL`, `PORT`

Extension build-time env (via wxt env interpolation — currently hardcoded, FIX REQUIRED):
- `VITE_BACKEND_WS_URL` → defaults to `wss://api.translate-voice.example/ws/translate` in prod
- `VITE_BACKEND_API_URL` → defaults to `https://api.translate-voice.example` in prod

## Known weaknesses (from production-readiness review 2026-05-13)

See `plans/reports/review-260513-0845-mvp-production-readiness.md` for the full list. The 5 most architecture-level blockers:

1. **JWT not plumbed end-to-end** — auth broken, popup→SW→WS misses the storage read.
2. **Webhook HMAC secret can be empty** — placeholder secret in repo allows free Pro grants.
3. **Subscription tier lookup not sorted** — paying users may be wrongly downgraded after upgrade/cancel/resub.
4. **CORS literal `chrome-extension://*` doesn't match anything** — preflight always blocked.
5. **Sign-in UX missing** — JWT must be in `chrome.storage.local` but no flow exists to put it there.

## Where to learn more

- `plans/260513-0027-translate-voice-extension/` — full phased plan + 8 phase files
- `plans/260513-0027-translate-voice-extension/research/researcher-01-mv3-audio-capture.md` — researched MV3 + AudioWorklet patterns
- `plans/260513-0027-translate-voice-extension/research/researcher-02-vietnamese-tts-providers.md` — TTS provider comparison
- `plans/reports/brainstorm-260513-0027-translate-voice-extension.md` — initial architecture brainstorm (3 options considered, S2 chosen)
- `plans/reports/cook-260513-0305-mvp-complete.md` — consolidated MVP build report
