export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  /** Timestamp in milliseconds from audio start */
  ts: number;
}

export interface ASRStartOptions {
  srcLang: string;
  sampleRate: 16000;
}

/**
 * ASRProvider — thin abstraction over streaming ASR backends.
 * DeepgramNova2Provider is the sole implementation for MVP.
 * AssemblyAI / Whisper streaming can be swapped in later without touching the WS layer.
 */
export interface ASRProvider {
  start(opts: ASRStartOptions): Promise<void>;
  sendAudio(pcm: Buffer): void;
  onTranscript(cb: (t: TranscriptEvent) => void): void;
  onError(cb: (err: Error) => void): void;
  stop(): Promise<void>;
}
