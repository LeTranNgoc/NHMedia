import { z } from 'zod';

export const settingsSchema = z.object({
  enabled: z.boolean().default(false),
  audioMode: z.enum(['voice-over', 'replacement']).default('voice-over'),
  duckingPercent: z.number().min(0).max(100).default(30),
  voiceGender: z.enum(['female', 'male']).default('female'),
  srcLanguage: z.enum(['auto', 'en', 'ja', 'ko', 'fr', 'de']).default('auto'),
  subtitle: z.boolean().default(true),
});

export type Settings = z.infer<typeof settingsSchema>;
