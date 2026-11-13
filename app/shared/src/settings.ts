import { z } from 'zod';
import { TEXT_RUN_KINDS, type TextRunKind } from './runs';

/** IANA timezone check without a luxon dependency (shared has none). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A style doc is prose the operator writes once and every text prompt carries.
 *  It applies to every text run kind unless the kind is listed in excludedKinds,
 *  so a kind added later is on by default for docs stored before it existed. */
export const StyleDocSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  body: z.string(),
  enabled: z.boolean(),
  excludedKinds: z.array(z.enum(TEXT_RUN_KINDS)),
});
export type StyleDoc = z.infer<typeof StyleDocSchema>;

export function styleDocApplies(doc: StyleDoc, kind: TextRunKind): boolean {
  return doc.enabled && !doc.excludedKinds.includes(kind);
}

export const SettingsSchema = z.object({
  scheduling: z.object({
    timezone: z.string().refine(isValidTimeZone, 'not a valid IANA timezone'),
    weeklyGoal: z.number().int().min(1).max(7).nullable(),
  }),
  runTimeoutMs: z.number().int().positive(),
  retrievalK: z.number().int().min(1).max(20),
  imageCandidateBatch: z.number().int().min(1).max(10),
  embeddingModel: z.string(),
  personaDoc: z.string(),
  goalDoc: z.string(),
  designLanguageDoc: z.string(),
  retroEveryMeasured: z.number().int().min(1).max(20),
  styleDocs: z.array(StyleDocSchema).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  scheduling: {
    timezone: 'America/Sao_Paulo',
    weeklyGoal: null,
  },
  runTimeoutMs: 600_000,
  retrievalK: 5,
  imageCandidateBatch: 4,
  embeddingModel: 'text-embedding-3-small',
  personaDoc: '',
  goalDoc: '',
  designLanguageDoc: '',
  retroEveryMeasured: 3,
  styleDocs: [],
};
