import { describe, expect, it } from 'vitest';
import { TELL_PATTERNS, lintTells, mergeTells } from './tells';
import { DEFAULT_SETTINGS, SettingsSchema, styleDocApplies, type StyleDoc } from './settings';
import { TEXT_RUN_KINDS } from './runs';

/** One positive and one negative sample per pattern id. Every id in TELL_PATTERNS
 *  must appear here, so a new pattern without coverage fails the suite. */
const FIXTURES: Record<string, { positive: string; negative: string }> = {
  'em-dash': { positive: 'a \u2014 b', negative: 'a - b' },
  'dash-substitute': { positive: 'a \u2013 b', negative: '10:30\u201311:30' },
  'curly-quote': { positive: '\u201chi\u201d', negative: '"hi"' },
  'ai-vocab': { positive: 'we delve into it', negative: 'we dig into it' },
  'fancy-is': { positive: 'it serves as a guide', negative: 'it is a guide' },
  'not-just-but': { positive: 'not just fast but cheap', negative: 'not fast but cheap' },
  'filler': { positive: 'in order to ship', negative: 'to ship' },
  'hedge-stack': { positive: 'this could potentially work', negative: 'this could work' },
  'metaphor-noun': { positive: 'the bedrock of it', negative: 'the base of it' },
  'plain-word': { positive: 'we utilize it', negative: 'we use it' },
  'announcement': { positive: 'excited to share this', negative: 'here is this' },
};

const ids = (text: string) => lintTells(text).map((t) => t.id);

describe('lintTells patterns', () => {
  it('every pattern id has a fixture', () => {
    expect(TELL_PATTERNS.map((p) => p.id).sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  for (const pattern of TELL_PATTERNS) {
    it(`${pattern.id} matches its positive and skips its negative`, () => {
      const fixture = FIXTURES[pattern.id]!;
      expect(ids(fixture.positive)).toContain(pattern.id);
      expect(ids(fixture.negative)).not.toContain(pattern.id);
    });
  }

  it('labels come through on the hit', () => {
    const [tell] = lintTells('a \u2014 b');
    expect(tell).toMatchObject({ id: 'em-dash', label: 'em dash', start: 2, end: 3 });
  });
});

describe('dash-substitute edge cases', () => {
  it('leaves CLI flags alone', () => {
    expect(ids('claude --settings x')).not.toContain('dash-substitute');
    expect(ids('npm --workspace web')).not.toContain('dash-substitute');
  });

  it('flags a double hyphen used as punctuation', () => {
    expect(ids('wait--no')).toContain('dash-substitute');
    expect(ids('a -- b')).toContain('dash-substitute');
  });

  it('leaves an unspaced en dash range alone', () => {
    expect(lintTells('10:30\u201311:30')).toEqual([]);
  });
});

describe('lintTells offsets and overlap', () => {
  it('counts UTF-16 units, so an accented character shifts nothing', () => {
    const tells = lintTells('café \u2014 bar');
    expect(tells).toHaveLength(1);
    expect(tells[0]!.start).toBe(5);
    expect(tells[0]!.end).toBe(6);
  });

  it('keeps overlapping hits from different patterns', () => {
    const tells = lintTells('not just a testament but a win');
    expect(tells.map((t) => t.id)).toEqual(['not-just-but', 'ai-vocab']);
    expect(tells[0]!.start).toBeLessThan(tells[1]!.start);
    expect(tells[0]!.end).toBeGreaterThan(tells[1]!.start);
  });

  it('sorts by start then end', () => {
    const tells = lintTells('we utilize it \u2014 then we delve');
    expect(tells.map((t) => t.start)).toEqual([...tells.map((t) => t.start)].sort((a, b) => a - b));
  });

  it('leaves the words the operator actually uses', () => {
    expect(lintTells('the underscore in the scaffolding of the harness')).toEqual([]);
    expect(lintTells('a vector, a primitive, an API surface, the landscape')).toEqual([]);
  });

  it('is stable across repeated calls', () => {
    const text = 'we utilize it and we delve';
    expect(lintTells(text)).toEqual(lintTells(text));
  });
});

describe('dash-substitute spans exactly the punctuation', () => {
  it('does not swallow the surrounding spaces', () => {
    for (const [text, want] of [['a -- b', '--'], ['a \u2013 b', '\u2013'], ['wait--no', '--']] as const) {
      const [tell] = lintTells(text);
      expect(tell, text).toBeDefined();
      expect(text.slice(tell!.start, tell!.end), text).toBe(want);
    }
  });

  it('leaves a flag alone however it is wrapped', () => {
    for (const text of ['claude --settings x', 'npm --workspace web', '`--settings` flag',
      '(--max-turns)', '"--allowedTools"', 'i--;']) {
      expect(ids(text), text).not.toContain('dash-substitute');
    }
  });
});

describe('the inflections slop actually reaches for', () => {
  it('flags them', () => {
    for (const text of ['empowering teams', 'enhanced output', 'we leveraged it', 'elevated results',
      'unlocking value', 'we utilized it', 'a game changer', 'a game-changer', 'delved into it',
      'fostered growth', 'garnered support', 'facilitated the call', 'showcased the work']) {
      expect(ids(text), text).not.toEqual([]);
    }
  });

  it('still leaves the operator own vocabulary alone', () => {
    for (const text of ['the elevator pitch', 'an elevation change', 'the harness surface',
      'a vector primitive', 'the underscore in scaffolding']) {
      expect(lintTells(text), text).toEqual([]);
    }
  });
});

describe('mergeTells', () => {
  it('merges overlapping hits and joins their labels', () => {
    const spans = mergeTells(lintTells('not just a testament but a win'));
    expect(spans).toHaveLength(1);
    expect(spans[0]!.labels).toEqual(['not just X but Y', 'AI vocabulary']);
  });

  it('keeps disjoint hits separate', () => {
    const spans = mergeTells(lintTells('we utilize it and we delve'));
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.labels)).toEqual([['fancier synonym'], ['AI vocabulary']]);
  });

  it('returns nothing for clean text', () => {
    expect(mergeTells(lintTells('a clean line'))).toEqual([]);
  });
});

describe('style docs', () => {
  const doc: StyleDoc = { id: 'unslop', name: 'unslop', body: 'no hype.', enabled: true, excludedKinds: [] };

  it('applies to every text run kind by default', () => {
    for (const kind of TEXT_RUN_KINDS) expect(styleDocApplies(doc, kind)).toBe(true);
  });

  it('skips a disabled doc', () => {
    expect(styleDocApplies({ ...doc, enabled: false }, 'draft')).toBe(false);
  });

  it('skips an excluded kind and keeps the rest', () => {
    const excluded = { ...doc, excludedKinds: ['triage' as const] };
    expect(styleDocApplies(excluded, 'triage')).toBe(false);
    expect(styleDocApplies(excluded, 'draft')).toBe(true);
  });

  it('parses a stored row that predates the key as an empty list', () => {
    const { styleDocs: _omitted, ...stored } = DEFAULT_SETTINGS;
    expect(SettingsSchema.parse(stored).styleDocs).toEqual([]);
  });

  it('rejects a doc id that is not a slug', () => {
    expect(() => SettingsSchema.parse({ ...DEFAULT_SETTINGS, styleDocs: [{ ...doc, id: 'Not A Slug' }] })).toThrow();
  });
});
describe('metaphor nouns: narrowed, not blunt', () => {
  it('leaves a product name and a standard technical term alone', () => {
    // The exact false-positive class appendix D excluded `harness`, `surface` and `vector` for.
    expect(lintTells('we run on Amazon Bedrock.')).toEqual([]);
    expect(lintTells('the actor paradigm in Erlang is the reference.')).toEqual([]);
  });

  it('still catches the flourish those words appear in', () => {
    expect(lintTells('trust is the bedrock of every review.').map((t) => t.id)).toContain('metaphor-noun');
    expect(lintTells('this is a genuine paradigm shift.').map((t) => t.id)).toContain('metaphor-noun');
    expect(lintTells('two paradigm shifts in one year.').map((t) => t.id)).toContain('metaphor-noun');
  });

  it('keeps the nouns that have no literal engineering use', () => {
    for (const word of ['substrate', 'wedge', 'locus', 'nexus', 'flywheel', 'endgame']) {
      expect(lintTells(`the ${word} of the system.`).map((t) => t.id)).toContain('metaphor-noun');
    }
  });
});
