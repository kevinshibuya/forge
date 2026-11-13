import { describe, expect, it } from 'vitest';
import { lintTells } from '@forge/shared';
import { readFileSync } from 'node:fs';
import {
  LEGACY_PERSONA_DOC, LEGACY_UNSLOP_BODY, PERSONA_DOC, PRE_0015_PERSONA_DOC, PRE_0015_UNSLOP_BODY,
  SEED_RULES, STYLE_DOCS,
} from './seed-content';

/** The spec is the contract: Task 6 says "copy the three appendices verbatim", so the test
 *  compares against the appendix itself rather than probing for a substring. A `toContain`
 *  check is what let the doc ship with its closing section missing. */
/** cwd-coupled like migrate.ts and seed.ts: the api specs run with cwd = app/api. */
const SPEC = '../../docs/superpowers/specs/2026-09-02-style-docs-and-research-runs-design.md';

function appendix(heading: string): string {
  const spec = readFileSync(SPEC, 'utf8');
  const at = spec.indexOf(`## ${heading}`);
  if (at === -1) throw new Error(`no appendix titled ${heading}`);
  const open = spec.indexOf('```', at);
  const close = spec.indexOf('```', open + 3);
  if (open === -1 || close === -1) throw new Error(`appendix ${heading} has no fenced block`);
  return spec.slice(spec.indexOf('\n', open) + 1, close).replace(/\n$/, '');
}

describe('seed content under the style docs', () => {
  it('ships seventeen rules', () => {
    expect(SEED_RULES).toHaveLength(17);
  });

  it('carries the four new rules', () => {
    const rules = SEED_RULES.map((r) => r.rule);
    for (const marker of [
      'two-line preview',                                    // 4: the hook stands alone
      'attributed inline in plain words',                    // 5: research facts name their source
      'three to five hashtags',                              // 6: hashtags trail the body
      'links go in the first comment',                       // 12: no links in the body
    ]) {
      expect(rules.some((r) => r.includes(marker)), `missing rule: ${marker}`).toBe(true);
    }
  });

  it('has no tells in any rule or rationale', () => {
    for (const { rule, rationale } of SEED_RULES) {
      expect(lintTells(rule), `rule: ${rule}`).toEqual([]);
      expect(lintTells(rationale), `rationale: ${rationale}`).toEqual([]);
    }
  });

  /** The persona and the doc body are deliberately NOT linted: the doc lists the banned words by
   *  construction and the persona names two hype adjectives as examples. */
  it('seeds one enabled unslop doc that applies to every kind', () => {
    expect(STYLE_DOCS).toHaveLength(1);
    const [doc] = STYLE_DOCS;
    expect(doc!.id).toBe('unslop');
    expect(doc!.enabled).toBe(true);
    expect(doc!.excludedKinds).toEqual([]);
  });

  it('the doc body is appendix A verbatim, closing section included', () => {
    expect(STYLE_DOCS[0]!.body).toBe(appendix('Appendix A: the `unslop` style doc'));
  });

  it('the persona is appendix B verbatim', () => {
    expect(PERSONA_DOC).toBe(appendix('Appendix B: the persona doc'));
  });

  it('every appendix A section is present', () => {
    const headings = STYLE_DOCS[0]!.body.match(/^## .+$/gm) ?? [];
    expect(headings).toEqual(['## punctuation', '## vocabulary', '## shapes', '## sentences', '## before answering']);
  });

  it('keeps every superseded body verbatim, one guard per migration that moved it', () => {
    // 0013 only APPENDED the closing section, so its guard body is still a prefix of what it
    // produced. 0015 edits the middle of the vocabulary section, so the prefix relationship stops
    // there: the current body is NOT legacy-plus-a-suffix any more, and asserting that it is would
    // be asserting a relationship the chain no longer has.
    expect(LEGACY_UNSLOP_BODY).not.toContain('## before answering');
    expect(PRE_0015_UNSLOP_BODY.startsWith(LEGACY_UNSLOP_BODY)).toBe(true);
    expect(PRE_0015_UNSLOP_BODY).toContain('## before answering');

    expect(STYLE_DOCS[0]!.body).not.toBe(PRE_0015_UNSLOP_BODY);
    expect(STYLE_DOCS[0]!.body).not.toBe(LEGACY_UNSLOP_BODY);
    // The rulings: two flat bans became judgement calls.
    expect(PRE_0015_UNSLOP_BODY).toContain('scaffolding, paradigm');
    expect(STYLE_DOCS[0]!.body).toContain('judgement calls, not bans');
  });

  it('keeps the persona guard for 0015 verbatim, and moves post shape under its own heading', () => {
    expect(PRE_0015_PERSONA_DOC).not.toBe(PERSONA_DOC);
    expect(PRE_0015_PERSONA_DOC).not.toContain('post structure:');
    expect(PERSONA_DOC).toContain('\npost structure:');
    // The aphorism keeps its shape only because the persona now names it as an exception.
    expect(PERSONA_DOC).toContain('perfect symmetry reads as machine-made.');
  });

  it('keeps the legacy persona verbatim and separate from the new one', () => {
    expect(LEGACY_PERSONA_DOC).not.toBe(PERSONA_DOC);
    expect(LEGACY_PERSONA_DOC).toContain('sentence case aesthetic');
    expect(PERSONA_DOC).toContain('sentence case everywhere');
    expect(PERSONA_DOC).toContain('named exceptions to the style docs');
  });

  it('the new persona names its exceptions and drops the old em dash', () => {
    expect(lintTells(PERSONA_DOC).filter((t) => t.id === 'em-dash')).toEqual([]);
    expect(lintTells(LEGACY_PERSONA_DOC).some((t) => t.id === 'em-dash')).toBe(true);
  });
});
