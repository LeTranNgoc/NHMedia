import type { WebSocket } from '@fastify/websocket';
import type { AudioFrame, TranslationFrame, ErrorFrame } from '@translate-voice/shared';

const LARGE_AUDIO_WARN_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * AudioFrameEmitter — encodes audio buffers to base64 and sends WS control frames.
 * Also sends translation (subtitle) frames alongside audio frames.
 */
export class AudioFrameEmitter {
  private readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
  }

  emitAudio(audio: Buffer, format: 'mp3' | 'opus'): void {
    if (audio.byteLength > LARGE_AUDIO_WARN_BYTES) {
      console.warn(`[AudioFrameEmitter] Large audio buffer: ${audio.byteLength} bytes`);
    }

    const frame: AudioFrame = {
      type: 'audio',
      data: audio.toString('base64'),
      format,
      ts: Date.now(),
    };
    this._send(frame);
  }

  emitTranslation(text: string): void {
    const frame: TranslationFrame = {
      type: 'translation',
      text,
      ts: Date.now(),
    };
    this._send(frame);
  }

  emitError(code: string, message: string): void {
    const frame: ErrorFrame = {
      type: 'error',
      code,
      message,
    };
    this._send(frame);
  }

  private _send(frame: AudioFrame | TranslationFrame | ErrorFrame): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }
}
