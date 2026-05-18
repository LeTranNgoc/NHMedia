import { z } from 'zod';

export const settingsSchema = z.object({
  enabled: z.boolean().default(false),
  audioMode: z.enum(['voice-over', 'replacement']).default('voice-over'),
  duckingPercent: z.number().min(0).max(100).default(30),
  voiceGender: z.enum(['female', 'male']).default('female'),
  srcLanguage: z.enum(['auto', 'en', 'ja', 'ko', 'fr', 'de', 'hi', 'zh-Hans']).default('auto'),
  targetLanguage: z.enum(['vi', 'en', 'ko', 'ja', 'fr', 'de', 'hi', 'zh-Hans']).default('vi'),
  subtitle: z.boolean().default(true),
  useAutoCC: z.boolean().default(true),
  /** Speech rate multiplier for the browser TTS dub (0.5..2.0).
   *  1.56 matches the server Cloud TTS rate (1.44) plus the natural slowness
   *  of browser synth — user-tunable when the dub sounds too fast / slow. */
  speechRate: z.number().min(0.5).max(2.0).default(1.56),
});

export type Settings = z.infer<typeof settingsSchema>;
