import { z } from 'zod';

/**
 * Pull the JSON object out of a model's raw output. The output usually arrives inside a
 * fenced block and sometimes carries prose either side of it.
 *
 * This lives in shared because two callers need it and only one had it. The runner used it
 * and parsed fine; the workspace called `JSON.parse` on the same string, threw on the
 * opening fence, and swallowed it in a catch, so a research run's `sources` never reached
 * the page even though the run had recorded them correctly.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found in output');
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

/** What a research run borrowed. `ref` is a staged path or a URL; `note` is what was taken
 *  from it, in the model's own words. Optional on the outputs below because a non-research
 *  run never produces one, and an older stored output has none. */
export const SourceSchema = z.object({
  kind: z.enum(['file', 'web']),
  ref: z.string().trim().min(1).max(2048),
  note: z.string().max(2000),
});
export type Source = z.infer<typeof SourceSchema>;

/** Field-wise, order-sensitive: a reorder is a real edit, and a wasted write is the only cost.
 *  Lives here beside the schema because the api and the sources editor both need the answer. */
export function sameSources(a: Source[], b: Source[]): boolean {
  return a.length === b.length
    && a.every((s, i) => s.kind === b[i]!.kind && s.ref === b[i]!.ref && s.note === b[i]!.note);
}

export const DraftOutputSchema = z.object({
  body_linkedin: z.string().min(1),
  hashtags: z.array(z.string()),
  image_concept: z.string().optional(),
  sources: z.array(SourceSchema).optional(),
});
export type DraftOutput = z.infer<typeof DraftOutputSchema>;

/** refine_selection rewrites one selected passage but returns the FULL revised body. */
export const RefineSelectionOutputSchema = z.object({
  body_linkedin: z.string().min(1),
  sources: z.array(SourceSchema).optional(),
});
export type RefineSelectionOutput = z.infer<typeof RefineSelectionOutputSchema>;

export const TriageOutputSchema = z.object({
  source: z.enum(['work', 'news', 'evergreen', 'braindump']),
  suggested_tier: z.enum(['T1', 'T2', 'T3']),
  news_expiry_days: z.number().int().positive().nullable(),
  notes: z.string(),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;
