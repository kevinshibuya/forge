import { describe, expect, it } from 'vitest';
import { collectTells } from './tell-fields';

describe('collectTells', () => {
  it('reads a bare key', () => {
    const tells = collectTells({ notes: 'we delve into it' }, ['notes']);
    expect(tells).toEqual([{ id: 'ai-vocab', label: 'AI vocabulary', start: 3, end: 8, field: 'notes' }]);
  });

  it('records the concrete index for an array of strings', () => {
    const tells = collectTells({ hashtags: ['#clean', '#robust', '#seamless'] }, ['hashtags[]']);
    expect(tells.map((t) => t.field)).toEqual(['hashtags[1]', 'hashtags[2]']);
  });

  it('records the concrete index and key for an array of objects', () => {
    const data = { proposals: [{ rule: 'utilize the hook', rationale: null }, { rule: 'fine', rationale: 'a \u2014 b' }] };
    const tells = collectTells(data, ['proposals[].rule', 'proposals[].rationale']);
    expect(tells.map((t) => t.field)).toEqual(['proposals[0].rule', 'proposals[1].rationale']);
  });

  it('skips missing, null and non-string values without throwing', () => {
    expect(collectTells({ notes: null, other: 7 }, ['notes', 'other', 'absent', 'gone[]', 'gone[].x'])).toEqual([]);
  });

  it('returns nothing for a non-object payload', () => {
    expect(collectTells('a \u2014 b', ['body_linkedin'])).toEqual([]);
    expect(collectTells(null, ['body_linkedin'])).toEqual([]);
  });

  it('keeps every field a caller declares', () => {
    const data = { body_linkedin: 'a \u2014 b', hashtags: ['#delve'], image_concept: 'the tapestry' };
    const fields = ['body_linkedin', 'hashtags[]', 'image_concept'];
    expect(collectTells(data, fields).map((t) => t.field)).toEqual(['body_linkedin', 'hashtags[0]', 'image_concept']);
  });

  it('resolves a nested key on a non-array path', () => {
    const tells = collectTells({ plan: { headline: 'we leverage it', subtext: 'clean' } }, ['plan.headline', 'plan.subtext']);
    expect(tells.map((t) => t.field)).toEqual(['plan.headline']);
    expect(tells[0]!.id).toBe('plain-word');
  });

  it('skips a nested path whose parent is not an object', () => {
    expect(collectTells({ plan: 'a string' }, ['plan.headline'])).toEqual([]);
    expect(collectTells({ plan: null }, ['plan.headline'])).toEqual([]);
  });
});