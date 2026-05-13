import { z } from 'zod';
import type { ClientControlFrame } from '@translate-voice/shared';

// ── Zod schemas for inbound client control frames ─────────────────────────────

// srcLang is a free string here — allowlist enforcement happens in relay-server.ts
// so the relay can send a structured {code:'invalid_src_lang'} error frame rather
// than a generic {code:'invalid_frame'}.
const configFrameSchema = z.object({
  type: z.literal('config'),
  srcLang: z.string().min(1),
  audioMode: z.enum(['voice-over', 'replacement']),
});

const pauseFrameSchema = z.object({ type: z.literal('pause') });
const resumeFrameSchema = z.object({ type: z.literal('resume') });
const flushFrameSchema = z.object({ type: z.literal('flush') });

const clientControlFrameSchema = z.discriminatedUnion('type', [
  configFrameSchema,
  pauseFrameSchema,
  resumeFrameSchema,
  flushFrameSchema,
]);

// ── ParsedFrame discriminated union ──────────────────────────────────────────

export type ParsedAudioFrame = { kind: 'audio'; pcm: Buffer };
export type ParsedControlFrame = { kind: 'control'; frame: ClientControlFrame };
export type ParsedFrame = ParsedAudioFrame | ParsedControlFrame;

/**
 * Parse a raw WS message into a typed ParsedFrame.
 *
 * Binary data  → ParsedAudioFrame  (PCM audio chunk)
 * String data  → ParsedControlFrame (zod-validated JSON)
 *
 * Throws on invalid JSON or schema violation.
 */
export function parseFrame(data: Buffer | ArrayBuffer | string): ParsedFrame {
  // ── Binary path ─────────────────────────────────────────────────────────────
  if (typeof data !== 'string') {
    const pcm =
      data instanceof Buffer
        ? data
        : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    return { kind: 'audio', pcm };
  }

  // ── Text path ───────────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error(`Invalid JSON control frame: ${data.slice(0, 80)}`);
  }

  const result = clientControlFrameSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid control frame: ${result.error.message}`);
  }

  return { kind: 'control', frame: result.data as ClientControlFrame };
}
