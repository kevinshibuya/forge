import { describe, expect, it } from 'vitest';
import { CONTRACT_LINE, lintTells, renderPrompt } from '@forge/shared';
import { assembleConstitution } from '../retrieval/constitution';
import { assembleTriagePrompt } from './triage-prompt';

/** A real constitution, so the assertions see what the model will see. */
const CONSTITUTION = assembleConstitution({
  kind: 'triage',
  settings: { personaDoc: 'lowercase, terse.', styleDocs: [{ id: 'unslop', name: 'unslop', body: 'no hype.', enabled: true, excludedKinds: [] }] },
  rules: [],
});


describe('assembleTriagePrompt', () => {
  it('embeds the idea, the four sources, three tiers, and the JSON contract', () => {
    const p = renderPrompt(assembleTriagePrompt(CONSTITUTION, 'codex quota tricks I learned'));
    expect(p).toContain('codex quota tricks I learned');
    for (const m of ['work', 'news', 'evergreen', 'braindump', 'T1', 'T2', 'T3',
      '"source"', '"suggested_tier"', '"news_expiry_days"', '"notes"']) {
      expect(p).toContain(m);
    }
    expect(p).toContain(CONTRACT_LINE);
  });

  it('carries the constitution, no rules block, and no em dash', () => {
    const p = renderPrompt(assembleTriagePrompt(CONSTITUTION, 'a dash free idea'));
    expect(p).toContain('## persona');
    expect(p).toContain('## style: unslop');
    expect(p).not.toContain('## playbook rules');
    expect(lintTells(p).filter((t) => t.id === 'em-dash')).toEqual([]);
  });
});
