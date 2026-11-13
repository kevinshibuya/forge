import { describe, expect, it } from 'vitest';
import { DraftOutputSchema, enforcedJsonSchema, unwrapResult, TriageOutputSchema } from '@forge/shared';
import { restoreOptionals, toProviderSchema } from './provider-schema';

type Json = Record<string, any>;

const envelope = enforcedJsonSchema(DraftOutputSchema);
const branches = (s: Json): Json[] => s.properties.result.anyOf;

describe('toProviderSchema', () => {
  it('rewrites the envelope oneOf to anyOf', () => {
    const out = toProviderSchema(envelope, { strict: false }) as Json;
    expect(out.properties.result.oneOf).toBeUndefined();
    expect(branches(out)).toHaveLength(2);
  });

  it('under strict, every payload key is required and a formerly optional key is nullable', () => {
    const payload = branches(toProviderSchema(envelope, { strict: true }) as Json)[0]!;
    expect([...payload.required].sort()).toEqual(['body_linkedin', 'hashtags', 'image_concept', 'sources']);
    expect(payload.properties.image_concept.anyOf).toContainEqual({ type: 'null' });
    expect(payload.properties.body_linkedin.anyOf).toBeUndefined();
    expect(payload.additionalProperties).toBe(false);
  });

  it('strips the keywords the provider grammars reject, at every depth', () => {
    const out = toProviderSchema(envelope, { strict: true }) as Json;
    const [payload, decline] = branches(out);
    expect(payload!.properties.body_linkedin.minLength).toBeUndefined();
    expect(decline!.properties.reason.minLength).toBeUndefined();
    const source = payload!.properties.sources.anyOf[0].items;
    expect(source.properties.ref.maxLength).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/"(minLength|maxLength|exclusiveMinimum|\$schema)"/);
    const triage = toProviderSchema(enforcedJsonSchema(TriageOutputSchema), { strict: true }) as Json;
    expect(JSON.stringify(triage)).not.toMatch(/"(exclusiveMinimum|minimum)"/);
  });

  it('keeps the decline const', () => {
    const decline = branches(toProviderSchema(envelope, { strict: true }) as Json)[1]!;
    expect(decline.properties.outcome.const).toBe('declined');
  });

  it('leaves required as it was when not strict, and never mutates its input', () => {
    const before = JSON.stringify(envelope);
    const payload = branches(toProviderSchema(envelope, { strict: false }) as Json)[0]!;
    expect([...payload.required].sort()).toEqual(['body_linkedin', 'hashtags']);
    expect(payload.properties.image_concept.anyOf).toBeUndefined();
    expect(JSON.stringify(envelope)).toBe(before);
  });
});

describe('restoreOptionals', () => {
  it('drops a null the original schema did not require, so the zod payload parses', () => {
    const raw = { result: { body_linkedin: 'x', hashtags: [], image_concept: null, sources: null } };
    const restored = restoreOptionals(raw, envelope);
    const unwrapped = unwrapResult(restored);
    expect(unwrapped.kind).toBe('payload');
    const parsed = DraftOutputSchema.safeParse((unwrapped as { value: unknown }).value);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ body_linkedin: 'x', hashtags: [] });
  });

  it('keeps a null the original allows, and restores inside the decline branch', () => {
    const triage = enforcedJsonSchema(TriageOutputSchema);
    const raw = { result: { source: 'work', suggested_tier: 'T2', news_expiry_days: null, notes: 'n' } };
    expect(restoreOptionals(raw, triage)).toEqual(raw);
    const declined = restoreOptionals({ result: { outcome: 'declined', reason: 'r', question: null } }, envelope);
    expect(declined).toEqual({ result: { outcome: 'declined', reason: 'r' } });
  });

  it('walks array items', () => {
    const raw = { result: { body_linkedin: 'x', hashtags: [], image_concept: 'c', sources: [{ kind: 'web', ref: 'u', note: 'n' }] } };
    expect(restoreOptionals(raw, envelope)).toEqual(raw);
  });
});
