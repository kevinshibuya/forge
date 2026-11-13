import { describe, expect, it } from 'vitest';
import { RunKindSchema, type RunKind } from './runs';
import { renderPrompt } from './engine';
import { ENGINES_BY_BACKEND, ModelRowPatchSchema, TASK_KEYS, costUsd, taskForKind, type ModelPrices, type TaskKey } from './registry';

const SONNET_5: ModelPrices = { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 10, imagePerUnit: 0 };
const NOTHING: ModelPrices = { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0, imagePerUnit: 0 };

describe('taskForKind', () => {
  it('maps every run kind the way modelKeyForKind did', () => {
    const expected: Record<RunKind, TaskKey> = {
      draft: 'draft_t3',
      refine_selection: 'draft_t3',
      triage: 'triage',
      image_html: 'image_html',
      image_gen: 'image_gen',
      image_review: 'image_review',
      retro: 'retro',
      image_hybrid: 'image_html',
      image_plan: 'image_html',
      image_variate: 'image_html',
      image_refine: 'image_gen',
    };
    for (const kind of RunKindSchema.options) expect(taskForKind(kind)).toBe(expected[kind]);
  });

  it('draft and refine_selection follow the tier', () => {
    for (const kind of ['draft', 'refine_selection'] as const) {
      expect(taskForKind(kind, 'T1')).toBe('draft_t1');
      expect(taskForKind(kind, 'T2')).toBe('draft_t2');
      expect(taskForKind(kind, 'T3')).toBe('draft_t3');
    }
  });

  it('only ever answers a task key', () => {
    for (const kind of RunKindSchema.options) expect(TASK_KEYS).toContain(taskForKind(kind, 'T1'));
  });
});

describe('costUsd', () => {
  it('prices input, cache write, cache read and output at the row rates', () => {
    const cost = costUsd({ inputTokens: 10_000, cacheWriteTokens: 0, cacheReadTokens: 40_000, outputTokens: 1_000 }, SONNET_5);
    expect(cost).toBeCloseTo(0.038, 9);
  });

  it('prices images per unit', () => {
    expect(costUsd({ images: 2 }, { ...NOTHING, imagePerUnit: 0.067 })).toBeCloseTo(0.134, 9);
  });

  it('is null when the provider reported nothing', () => {
    expect(costUsd({}, SONNET_5)).toBeNull();
  });

  it('a codex session total prices at nothing and the image it made does not', () => {
    expect(costUsd({ outputTokens: 33_538, images: 1 }, { ...NOTHING, imagePerUnit: 0.25 })).toBeCloseTo(0.25, 9);
  });
});

describe('renderPrompt', () => {
  it('joins the system texts and the user turn with one blank line', () => {
    expect(renderPrompt({ system: [{ text: 'a' }, { text: 'b', cache: true }], user: 'c' })).toBe('a\n\nb\n\nc');
  });
});

describe('ModelRowPatchSchema', () => {
  it('refuses a key it does not know', () => {
    expect(ModelRowPatchSchema.safeParse({ task: 'x' }).success).toBe(false);
  });

  it('a price fits its numeric(12,6) column', () => {
    expect(ModelRowPatchSchema.safeParse({ inputPerMtok: 1e7 }).success).toBe(false);
    expect(ModelRowPatchSchema.safeParse({ inputPerMtok: 999_999 }).success).toBe(true);
  });

  it('refuses google until slice 10 ships its engine', () => {
    expect(ModelRowPatchSchema.safeParse({ engine: 'google' }).success).toBe(false);
  });

  it('refuses a negative price and accepts a null effort', () => {
    expect(ModelRowPatchSchema.safeParse({ inputPerMtok: -1 }).success).toBe(false);
    expect(ModelRowPatchSchema.safeParse({ effort: null, outputPerMtok: 10 }).success).toBe(true);
  });

  it('knows the engines of each backend', () => {
    expect(ENGINES_BY_BACKEND.cli).toEqual(['claude', 'codex']);
    expect(ENGINES_BY_BACKEND.api).toEqual(['anthropic', 'openai']);
  });
});
