import { describe, expect, it } from 'vitest';
import { CONTRACT_LINE, lintTells, renderPrompt } from '@forge/shared';
import { assembleConstitution } from '../retrieval/constitution';
import { assembleRetroPrompt } from './retro-prompt';

/** A real constitution, so the assertions see what the model will see. */
const CONSTITUTION = assembleConstitution({
  kind: 'retro',
  settings: { personaDoc: 'lowercase, terse.', styleDocs: [{ id: 'unslop', name: 'unslop', body: 'no hype.', enabled: true, excludedKinds: [] }] },
  rules: [],
});


describe('assembleRetroPrompt', () => {
  it('layers goal, current rules with ids, measured posts, and the JSON contract', () => {
    const prompt = renderPrompt(assembleRetroPrompt({
      constitution: CONSTITUTION,
      goal: 'fix problems faster',
      rules: [{ id: 7, category: 'timing', rule: 'publish 9:00-10:00', rationale: 'overlap' }],
      posts: [{
        postId: 1, tier: 'T1', hook: 'the idle transaction', body: 'body text',
        metrics: { impressions: 1000, er: 2.6, reactions: 20, comments: 6, shares: 0, saves: 0, followsGained: 4 },
        demographicsSummary: 'seniority: Iniciante 21%, Sênior 8% · locations: São Paulo 7%',
        activeRuleIds: [7],
      }],
    }));
    const order = ['## the goal', 'fix problems faster', '## active playbook rules', '[#7 timing]',
      '## measured posts', 'the idle transaction', '2.6% ER', 'drafted under rules: 7', '## output contract', '"proposals"'];
    let cursor = -1;
    for (const marker of order) {
      const at = prompt.indexOf(marker);
      expect(at, `missing or misordered: ${marker}`).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(prompt).toContain('target_rule_id');
    expect(prompt).toContain(CONTRACT_LINE);
  });

  it('carries the constitution but keeps its own id-bearing rule block', () => {
    const prompt = renderPrompt(assembleRetroPrompt({
      constitution: CONSTITUTION,
      goal: 'a dash free goal',
      rules: [{ id: 7, category: 'timing', rule: 'publish 9:00-10:00', rationale: 'overlap' }],
      posts: [],
    }));
    expect(prompt).toContain('## persona');
    expect(prompt).toContain('## style: unslop');
    expect(prompt).not.toContain('## playbook rules');   // the constitution carries no rules
    expect(prompt).toContain('[#7 timing]');             // retro's own block still has the ids
    expect(prompt.indexOf('## persona')).toBeLessThan(prompt.indexOf('## the goal'));
    expect(lintTells(prompt).filter((t) => t.id === 'em-dash')).toEqual([]);
  });
});
