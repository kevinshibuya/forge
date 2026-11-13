import { z } from 'zod';
import type { EngineBackend, EngineName, EngineUsage } from './engine';
import type { PostTier, RunKind } from './runs';

/** The model registry's task keys: one row per task and backend (ADR 0019). */
export const TASK_KEYS = ['draft_t1', 'draft_t2', 'draft_t3', 'triage', 'image_html', 'image_gen', 'image_review', 'retro'] as const;
export type TaskKey = typeof TASK_KEYS[number];

/** The registry task a run kind resolves to. refine_selection is a drafting call and follows the tier. */
export function taskForKind(kind: RunKind, tier?: PostTier): TaskKey {
  if (kind === 'draft' || kind === 'refine_selection') {
    if (tier === 'T1') return 'draft_t1';
    if (tier === 'T2') return 'draft_t2';
    return 'draft_t3';
  }
  if (kind === 'image_hybrid' || kind === 'image_plan' || kind === 'image_variate') return 'image_html';
  if (kind === 'image_refine') return 'image_gen';
  return kind;
}

export interface ModelPrices {
  inputPerMtok: number;
  cacheWritePerMtok: number;
  cacheReadPerMtok: number;
  outputPerMtok: number;
  imagePerUnit: number;
}

/** A call's cost in USD at the row's prices. Null when the provider reported no count at all. */
export function costUsd(u: EngineUsage, p: ModelPrices): number | null {
  const counts = [u.inputTokens, u.cacheWriteTokens, u.cacheReadTokens, u.outputTokens, u.images];
  if (counts.every((c) => c === undefined)) return null;
  return (u.inputTokens ?? 0) / 1e6 * p.inputPerMtok
    + (u.cacheWriteTokens ?? 0) / 1e6 * p.cacheWritePerMtok
    + (u.cacheReadTokens ?? 0) / 1e6 * p.cacheReadPerMtok
    + (u.outputTokens ?? 0) / 1e6 * p.outputPerMtok
    + (u.images ?? 0) * p.imagePerUnit;
}

export const ENGINES_BY_BACKEND: Record<EngineBackend, readonly EngineName[]> = {
  cli: ['claude', 'codex'],
  // `google` returns with slice 10's engine (narrowing 2). `EngineName` keeps the name.
  api: ['anthropic', 'openai'],
};

/** The prices' column is `numeric(12,6)`, whose largest value is 999999.999999. */
const price = z.number().nonnegative().max(999_999);

/** What `PATCH /registry/:id` accepts. `task` and `backend` are the row's identity and never patch. */
export const ModelRowPatchSchema = z.object({
  engine: z.enum(['claude', 'codex', 'anthropic', 'openai']).optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).nullable().optional(),
  maxOutputTokens: z.number().int().min(256).max(128_000).optional(),
  inputPerMtok: price.optional(),
  cacheWritePerMtok: price.optional(),
  cacheReadPerMtok: price.optional(),
  outputPerMtok: price.optional(),
  imagePerUnit: price.optional(),
}).strict();
export type ModelRowPatch = z.infer<typeof ModelRowPatchSchema>;
