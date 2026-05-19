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
import { TranslateProviderChain } from '../providers/translate/translate-provider-chain.js';
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

/** Choose translate provider chain based on env config. The primary provider
 *  is the explicit choice (TRANSLATE_PROVIDER). Any other provider with a key
 *  becomes a fallback link — so a Groq 429 cascades to Gemini, not to user
 *  silence. Single-provider chain returned when only one key is set.
 *
 *  Ordering inside the chain: primary first, then by latency/cost preference
 *  (Groq fastest, Azure highest quota, Gemini last because of 15 RPM cap). */
export function pickTranslateProvider(
  env: Pick<Env, 'TRANSLATE_PROVIDER' | 'AZURE_TRANSLATOR_KEY' | 'GEMINI_API_KEY' | 'GROQ_API_KEY'>,
): TranslateProvider {
  const choice = env.TRANSLATE_PROVIDER;
  const available: Array<{
    name: string;
    key: 'groq' | 'azure' | 'gemini';
    provider: TranslateProvider;
  }> = [];

  if (env.GROQ_API_KEY) {
    // Each Groq model has its OWN daily quota. Stacking them multiplies free
    // capacity: 8b (6K/day) + gemma2 (14K/day) + 70b (1K/day) = ~21K/day vs
    // 6K with a single model. Order = fastest/cheapest first so quality cost
    // is paid only when faster tiers are exhausted.
    available.push({
      name: 'Groq-Llama-8b',
      key: 'groq',
      provider: new GroqTranslateProvider({
        apiKey: env.GROQ_API_KEY,
        model: 'llama-3.1-8b-instant',
      }),
    });
    available.push({
      name: 'Groq-Gemma2-9b',
      key: 'groq',
      provider: new GroqTranslateProvider({
        apiKey: env.GROQ_API_KEY,
        model: 'gemma2-9b-it',
      }),
    });
    available.push({
      name: 'Groq-Llama-70b',
      key: 'groq',
      provider: new GroqTranslateProvider({
        apiKey: env.GROQ_API_KEY,
        model: 'llama-3.3-70b-versatile',
      }),
    });
  }
  if (env.AZURE_TRANSLATOR_KEY) {
    available.push({
      name: 'Azure',
      key: 'azure',
      provider: new AzureTranslateProvider({ apiKey: env.AZURE_TRANSLATOR_KEY }),
    });
  }
  if (env.GEMINI_API_KEY) {
    available.push({
      name: 'Gemini',
      key: 'gemini',
      provider: new GeminiFlashProvider({ apiKey: env.GEMINI_API_KEY }),
    });
  }

  if (available.length === 0) {
    console.warn('[translate] no provider keys set — Gemini fallback with empty key (will fail)');
    return new GeminiFlashProvider({ apiKey: '' });
  }

  // Hoist the user-chosen provider to the front when its key is present.
  available.sort((a, b) => {
    if (a.key === choice) return -1;
    if (b.key === choice) return 1;
    return 0;
  });

  console.info(`[translate] chain = ${available.map((p) => p.name).join(' → ')}`);

  if (available.length === 1) {
    return available[0]!.provider;
  }
  return new TranslateProviderChain(available.map(({ name, provider }) => ({ name, provider })));
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

    // Parse srcLang from URL query — extension provides this as a hint so the
    // backend can auto-start ASR if the client never sends a config frame
    // (extension wiring race / older builds). Falls back to 'en' if missing.
    const rawUrl = request.raw.url ?? '';
    const queryMatch = rawUrl.match(/[?&]srcLang=([a-zA-Z-]+)/);
    const urlSrcLang =
      queryMatch && (ALLOWED_SRC_LANGS as readonly string[]).includes(queryMatch[1])
        ? queryMatch[1]
        : 'en';

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
      // Map the underlying ASR error to a specific client-visible code so the
      // extension can decide between (a) reconnecting the WS, (b) requesting a
      // fresh tab-capture streamId, or (c) showing an auth error to the user.
      // Previously all ASR errors were labelled 'asr_auth' — extension treated
      // a dead tab-capture stream as auth failure and gave up.
      let code: 'asr_auth' | 'asr_dead' | 'asr_error' = 'asr_error';
      if (err.message === 'asr_auth') code = 'asr_auth';
      else if (err.message === 'asr_reconnect_exhausted') code = 'asr_dead';
      const frame: ServerControlFrame = { type: 'error', code, message: err.message };
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(frame));
        socket.close(1011, code);
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
      onBackpressure: (() => {
        // Rate-limit warnings: once-saturated, fires per-frame (10/sec) → log
        // spam. Log first occurrence + once per 10s thereafter.
        let lastWarnAt = 0;
        return () => {
          const now = Date.now();
          if (now - lastWarnAt < 10_000) return;
          lastWarnAt = now;
          const frame: ServerControlFrame = {
            type: 'warning',
            code: 'backpressure',
            message: 'Backpressure counter saturated (frames NOT dropped — observability only)',
          };
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(frame));
          }
          app.log.warn(
            { userId, sessionId },
            'Backpressure: counter saturated (no drops — sparse ASR transcripts not draining BP)',
          );
        };
      })(),
    });

    let asrStarted = false;
    let asrStarting = false;
    let autoStartTriggered = false;
    let audioDroppedBeforeConfig = 0;
    // Resilience: buffer the latest N audio frames received before config.
    // When config arrives, drain them into ASR so the first second of speech
    // doesn't get lost to a race between client open + config send + audio start.
    // FIFO, bounded — older frames evicted when full.
    const PRE_CONFIG_BUFFER_MAX = 50; // ~5s at 100ms/frame
    const preConfigAudioBuffer: Buffer[] = [];
    // Captured from the most recent config frame so `flush` restarts ASR
    // with the user's chosen language, not a default.
    let currentSrcLang: string = urlSrcLang;

    /** Start ASR + create orchestrator. Idempotent — guards against double-start
     *  when both audio (auto-start) and config arrive in quick succession. */
    const startAsrAndOrchestrator = async (
      srcLang: string,
      targetLang: string,
      _audioMode: string,
    ): Promise<void> => {
      if (asrStarted || asrStarting) return;
      asrStarting = true;
      currentSrcLang = srcLang;

      orchestrator?.destroy();
      orchestrator = new PipelineOrchestrator({
        socket,
        translateProvider,
        ttsProvider,
        srcLang,
        targetLang,
        ttsDisabled: backendTtsDisabled === true,
        onTranslateComplete: usageTracker
          ? (chars) => usageTracker.tick(userId, chars, 'translateChars')
          : undefined,
        onTtsComplete: usageTracker
          ? (chars) => usageTracker.tick(userId, chars, 'ttsChars')
          : undefined,
      });

      try {
        await asr.start({ srcLang, sampleRate: 16000 });
        asrStarted = true;
        asrStarting = false;
        app.log.info({ userId, sessionId, srcLang }, 'ASR session started');
        if (preConfigAudioBuffer.length > 0) {
          app.log.info(
            { userId, sessionId, replaying: preConfigAudioBuffer.length },
            'replaying pre-config audio buffer to ASR',
          );
          for (const pcm of preConfigAudioBuffer) {
            bp.frameSent();
            asr.sendAudio(pcm);
          }
          preConfigAudioBuffer.length = 0;
        }
      } catch (err) {
        asrStarting = false;
        const msg = err instanceof Error ? err.message : String(err);
        app.log.error({ userId, sessionId, err: msg }, 'ASR start failed');
        if (socket.readyState === socket.OPEN) {
          const errFrame: ServerControlFrame = {
            type: 'error',
            code: 'asr_start_failed',
            message: msg,
          };
          socket.send(JSON.stringify(errFrame));
          socket.close(1011, 'asr_start_failed');
        }
      }
    };
    // C3 defense: when a caption frame arrives within the last 5s, the CC
    // path is considered active and ASR transcripts are suppressed to
    // prevent the orchestrator from translating the same segment twice.
    let lastCaptionFrameAt = 0;
    let audioSuppressedByCaption = 0;
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
          // Buffer the chunk + trigger auto-start once. Backend cannot rely on
          // client always sending config first — historical bugs in extension
          // wiring + edge browser builds put audio first. Auto-start with the
          // URL-query srcLang (default 'en') unblocks the pipeline immediately;
          // a later config frame can still adjust translation target.
          preConfigAudioBuffer.push(parsed.pcm);
          if (preConfigAudioBuffer.length > PRE_CONFIG_BUFFER_MAX) {
            preConfigAudioBuffer.shift();
            audioDroppedBeforeConfig++;
          }
          if (!autoStartTriggered) {
            autoStartTriggered = true;
            app.log.warn(
              { userId, sessionId, urlSrcLang },
              'audio arrived before config — auto-starting ASR with URL srcLang fallback',
            );
            void startAsrAndOrchestrator(urlSrcLang, 'vi', 'voice-over');
          }
          return;
        }
        // Cost saver: when captions-first path is active (caption frames flowing
        // in the last 5s), skip forwarding audio to Deepgram. CC is the source
        // of truth — paying for ASR while suppressing its output is pure waste.
        // Drops at message-handler level keep the Deepgram WS open (cheap) and
        // resume automatically when caption flow stops.
        if (Date.now() - lastCaptionFrameAt < CAPTION_ACTIVE_WINDOW_MS) {
          audioSuppressedByCaption++;
          if (audioSuppressedByCaption === 1 || audioSuppressedByCaption % 500 === 0) {
            app.log.info(
              { userId, sessionId, suppressed: audioSuppressedByCaption },
              'audio frame suppressed by caption path (Deepgram cost saved)',
            );
          }
          return;
        }
        // BP saturation no longer drops frames. Dropping caused a cascade:
        // long silence with no transcripts → counter saturated at max → drop
        // → no audio to Deepgram → idle-close 1011 → reconnect → counter
        // still saturated (no ACKs during reconnect) → drop → idle-close
        // again → loop until exhausted. Deepgram has its own WS buffering;
        // relay-level drop is net-negative. Still invoke shouldDrop() for
        // the client-facing warning-frame side-effect (observability).
        bp.shouldDrop();
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

        // If auto-start already ran with URL srcLang and config now disagrees,
        // tear down + restart ASR with the user's intended lang. Otherwise just
        // ensure ASR is up (idempotent).
        void (async () => {
          if (asrStarted && srcLang !== currentSrcLang) {
            app.log.info(
              { userId, sessionId, oldLang: currentSrcLang, newLang: srcLang },
              'config srcLang differs from auto-start — restarting ASR',
            );
            await asr.stop();
            asrStarted = false;
            asrStarting = false;
          }
          await startAsrAndOrchestrator(srcLang, targetLang, frame.audioMode ?? 'voice-over');
        })();
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
