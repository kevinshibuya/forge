import { describe, expect, it } from 'vitest';
import { CONTRACT_LINE, lintTells, type StyleDoc } from '@forge/shared';
import { JSON_ONLY_LINE, PRECEDENCE_LINE, assembleConstitution, personaFor } from './constitution';
import { PERSONA_DOC } from '../seed/seed-content';

const doc = (over: Partial<StyleDoc> = {}): StyleDoc => ({
  id: 'unslop', name: 'unslop', body: 'no hype adjectives.', enabled: true, excludedKinds: [], ...over,
});

const settings = (styleDocs: StyleDoc[], personaDoc = 'kevin writes in lowercase.') => ({ personaDoc, styleDocs });

describe('assembleConstitution', () => {
  it('emits persona, rules, style docs, then the two constant lines', () => {
    const text = assembleConstitution({
      kind: 'draft',
      settings: settings([doc()]),
      rules: [{ category: 'voice', rule: 'no exclamation marks' }],
    });

    expect(text).toBe([
      '## persona',
      'kevin writes in lowercase.',
      '',
      '## playbook rules',
      '- [voice] no exclamation marks',
      '',
      '## style: unslop',
      'no hype adjectives.',
      '',
      PRECEDENCE_LINE,
      '',
      JSON_ONLY_LINE,
    ].join('\n'));
  });

  it('omits the rules section entirely when there are no rules', () => {
    const text = assembleConstitution({ kind: 'retro', settings: settings([doc()]), rules: [] });
    expect(text).not.toContain('## playbook rules');
    expect(text).toContain('## persona');
    expect(text).toContain('## style: unslop');
  });

  it('skips a disabled doc', () => {
    const text = assembleConstitution({ kind: 'draft', settings: settings([doc({ enabled: false })]), rules: [] });
    expect(text).not.toContain('## style: unslop');
  });

  it('skips a doc that excludes the kind, and keeps it for every other kind', () => {
    const settingsWithExclusion = settings([doc({ excludedKinds: ['triage'] })]);
    expect(assembleConstitution({ kind: 'triage', settings: settingsWithExclusion, rules: [] })).not.toContain('## style: unslop');
    expect(assembleConstitution({ kind: 'draft', settings: settingsWithExclusion, rules: [] })).toContain('## style: unslop');
  });

  it('keeps the docs in list order', () => {
    const text = assembleConstitution({
      kind: 'draft',
      settings: settings([doc({ id: 'first', name: 'first' }), doc({ id: 'second', name: 'second' })]),
      rules: [],
    });
    expect(text.indexOf('## style: first')).toBeLessThan(text.indexOf('## style: second'));
  });

  it('closes with the contract line, which names the result key and the decline envelope', () => {
    expect(JSON_ONLY_LINE).toBe(CONTRACT_LINE);
    expect(JSON_ONLY_LINE).toContain('"result"');
    expect(JSON_ONLY_LINE).toContain('"outcome":"declined"');
  });

  it('emits the precedence line even with no applicable docs, and the JSON line last', () => {
    const text = assembleConstitution({ kind: 'image_plan', settings: settings([]), rules: [] });
    expect(text).toContain(PRECEDENCE_LINE);
    expect(text.endsWith(JSON_ONLY_LINE)).toBe(true);
    expect(text.indexOf(PRECEDENCE_LINE)).toBeLessThan(text.indexOf(JSON_ONLY_LINE));
  });

  it('adds no tells of its own', () => {
    const text = assembleConstitution({ kind: 'draft', settings: settings([], ''), rules: [] });
    expect(lintTells(text)).toEqual([]);
  });
});

describe('personaFor: post shape reaches post kinds only', () => {
  const persona = [
    'alex sample, engineer.',
    '',
    'voice:',
    '- lowercase everywhere.',
    '- english only.',
    '',
    'post structure:',
    '- the arc: instinct then reversal.',
    '- close with one genuine question.',
    '',
    'named exceptions to the style docs (these win where the two disagree):',
    '- glyph bullets in the ONE technical block.',
  ].join('\n');

  it('hands a draft the whole persona', () => {
    expect(personaFor(persona, 'draft')).toBe(persona);
    expect(personaFor(persona, 'refine_selection')).toBe(persona);
  });

  it('drops the post-shape section for kinds that write no post, and keeps the rest', () => {
    for (const kind of ['triage', 'retro', 'image_plan', 'image_variate', 'image_review'] as const) {
      const sliced = personaFor(persona, kind);
      // A triage note has no arc to follow and no reader to close a question on.
      expect(sliced).not.toContain('post structure:');
      expect(sliced).not.toContain('close with one genuine question');
      // Voice and the named exceptions still apply to every word the app writes.
      expect(sliced).toContain('- lowercase everywhere.');
      expect(sliced).toContain('- english only.');
      expect(sliced).toContain('named exceptions to the style docs');
      expect(sliced).toContain('- glyph bullets in the ONE technical block.');
    }
  });

  it('returns a persona with no such heading untouched, whatever the kind', () => {
    // The operator edits this doc by hand in Settings. A persona that never grew the heading must
    // never be silently truncated.
    const plain = 'alex sample, engineer.\n\nvoice:\n- lowercase everywhere.';
    expect(personaFor(plain, 'triage')).toBe(plain);
    expect(personaFor('', 'triage')).toBe('');
  });

  it('handles the post-shape section sitting last, with nothing after it', () => {
    const trailing = 'alex sample.\n\nvoice:\n- terse.\n\npost structure:\n- the arc.';
    expect(personaFor(trailing, 'triage')).toBe('alex sample.\n\nvoice:\n- terse.');
  });

  it('the real seeded persona loses its post shape for a triage run and keeps its voice', () => {
    expect(personaFor(PERSONA_DOC, 'triage')).not.toContain('close with one genuine question');
    expect(personaFor(PERSONA_DOC, 'triage')).toContain('english only.');
    expect(personaFor(PERSONA_DOC, 'draft')).toContain('close with one genuine question');
  });
});
