import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { CONTRACT_LINE, DeclineSchema, STRUCTURED_OUTPUT_TOOL, enforcedJsonSchema, unwrapResult } from './contract';
import { DraftOutputSchema, RefineSelectionOutputSchema, TriageOutputSchema } from './outputs';
import { RetroOutputSchema } from './retro';
import { HybridDirectionsSchema, HybridPlanSchema, ImageReviewOutputSchema } from './images';

/** One sample per schema-bearing kind, each accepted by its zod schema. */
const SAMPLES: Array<[string, ZodTypeAny, unknown]> = [
  ['draft', DraftOutputSchema, {
    body_linkedin: 'mornings suit writing.',
    hashtags: ['#writing', '#mornings'],
    image_concept: 'a desk at dawn',
    sources: [{ kind: 'web', ref: 'https://example.com', note: 'the claim about dawn' }],
  }],
  ['refine_selection', RefineSelectionOutputSchema, { body_linkedin: 'the full revised body.' }],
  ['triage', TriageOutputSchema, { source: 'work', suggested_tier: 'T2', news_expiry_days: null, notes: 'agents pinned to models' }],
  ['retro', RetroOutputSchema, {
    proposals: [{ action: 'add', category: 'voice', target_rule_id: null, rule: 'no hedging', rationale: 'three posts hedged' }],
  }],
  ['image_review', ImageReviewOutputSchema, { scores: [{ assetId: 3, score: 71, notes: 'legible headline' }] }],
  ['image_plan', HybridPlanSchema, {
    backgroundPrompt: 'a fog bank over a harbour', headline: 'ship it', textZone: 'lower-third', palette: 'ink on paper',
  }],
  ['image_variate', HybridDirectionsSchema, { directions: ['flat colour blocks', 'a single photograph'] }],
];

describe('enforcedJsonSchema', () => {
  const ajv = new Ajv({ strict: false });

  for (const [kind, schema, sample] of SAMPLES) {
    describe(kind, () => {
      const validate = ajv.compile(enforcedJsonSchema(schema));

      it('the sample passes the zod schema itself', () => {
        expect(schema.safeParse(sample).success).toBe(true);
      });
      it('accepts the payload under result', () => {
        expect(validate({ result: sample })).toBe(true);
      });
      it('accepts a decline under result', () => {
        expect(validate({ result: { outcome: 'declined', reason: 'x' } })).toBe(true);
      });
      it('rejects prose, an empty wrapper, and the bare payload', () => {
        expect(validate({ result: 'prose' })).toBe(false);
        expect(validate({})).toBe(false);
        expect(validate(sample)).toBe(false);
      });
    });
  }

  it('nests the union under a required result and forbids other keys', () => {
    const schema = enforcedJsonSchema(DraftOutputSchema) as {
      type: string; required: string[]; additionalProperties: boolean; properties: { result: { oneOf: unknown[] } }; $schema?: unknown;
    };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['result']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.result.oneOf).toHaveLength(2);
    expect(schema.$schema).toBeUndefined();
    expect(JSON.stringify(schema)).not.toContain('$schema');
  });
});

describe('unwrapResult', () => {
  const payload = { body_linkedin: 'x', hashtags: [] };
  const decline = { outcome: 'declined', reason: 'placeholder idea', question: 'is post 5 a smoke test?' };

  it('returns the payload from the wrapper', () => {
    expect(unwrapResult({ result: payload })).toEqual({ kind: 'payload', value: payload });
  });
  it('returns the decline from the wrapper', () => {
    expect(unwrapResult({ result: decline })).toEqual({ kind: 'declined', decline });
  });
  it('treats a bare payload as malformed', () => {
    expect(unwrapResult(payload).kind).toBe('malformed');
  });
  it('treats a bare decline as malformed', () => {
    expect(unwrapResult(decline).kind).toBe('malformed');
  });
  it('hands an empty-reason decline on as a payload, for the kind schema to reject', () => {
    const empty = { outcome: 'declined', reason: '' };
    expect(unwrapResult({ result: empty })).toEqual({ kind: 'payload', value: empty });
  });
  it('treats a string and null as malformed', () => {
    expect(unwrapResult('prose').kind).toBe('malformed');
    expect(unwrapResult(null).kind).toBe('malformed');
  });
});

describe('the contract line and the tool name', () => {
  it('names the decline keys, the result key, and the three conditions', () => {
    expect(CONTRACT_LINE).toContain('"outcome":"declined"');
    expect(CONTRACT_LINE).toContain('reason');
    expect(CONTRACT_LINE).toContain('question');
    expect(CONTRACT_LINE).toContain('result');
    expect(CONTRACT_LINE).toBe(CONTRACT_LINE.toLowerCase());
    expect(CONTRACT_LINE).not.toContain('—');
  });
  it('accepts the decline envelope with and without a question', () => {
    expect(DeclineSchema.safeParse({ outcome: 'declined', reason: 'r' }).success).toBe(true);
    expect(DeclineSchema.safeParse({ outcome: 'declined', reason: '' }).success).toBe(false);
  });
  it('names the CLI tool that fulfils the schema', () => {
    expect(STRUCTURED_OUTPUT_TOOL).toBe('StructuredOutput');
  });
});
