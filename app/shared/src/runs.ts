import { z } from 'zod';

export const RunKindSchema = z.enum(['draft', 'triage', 'image_html', 'image_gen', 'image_review', 'retro', 'image_hybrid', 'image_plan', 'image_variate', 'refine_selection', 'image_refine']);
export type RunKind = z.infer<typeof RunKindSchema>;

export const RunStatusSchema = z.enum(['running', 'succeeded', 'failed', 'timeout']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export type FailureKind = 'timeout' | 'quota' | 'spawn_error' | 'nonzero_exit' | 'invalid_output' | 'declined' | 'other';
export type PostTier = 'T1' | 'T2' | 'T3';

/** One tool a fenced run used, as the legacy column `runs.tool_calls` holds it. Read-only since
 *  slice 2, written by no code path, dropped in slice 12's contract migration. */
export interface ToolCall {
  tool: string;
  ref: string;
  ok: boolean;
  outsideRoot?: boolean;
}

/** Run kinds whose output is prose a human reads. These are the kinds a style doc
 *  can apply to and the kinds the constitution is assembled for. */
export const TEXT_RUN_KINDS = ['draft', 'refine_selection', 'image_plan', 'retro', 'triage', 'image_review', 'image_variate'] as const;
export type TextRunKind = typeof TEXT_RUN_KINDS[number];
