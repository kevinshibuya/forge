import { describe, expect, it } from 'vitest';
import { renderPrompt } from '@forge/shared';
import { assembleConstitution } from './constitution';
import { assembleDraftPrompt, TIER_SPECS } from './prompt-assembly';

/** The builder now takes the assembled block as an opaque string; assembling it here
 *  keeps the ordering assertions honest about what a real prompt looks like. */
const CONSTITUTION = assembleConstitution({
  kind: 'draft',
  settings: { personaDoc: 'lowercase, terse, numbers as credibility anchors', styleDocs: [] },
  rules: [
    { category: 'structure', rule: 'hook → story → one bullet block → aphorism → question' },
    { category: 'timing', rule: 'publish 9:00-10:00' },
  ],
});

const base = {
  constitution: CONSTITUTION,
  exemplars: [{
    sourceType: 'post' as const, sourceId: 1, similarity: 0.91,
    chunkText: 'our checkout API slowed to 9 seconds a request...',
    performanceNote: '1000 impressions, 2.6% ER',
  }],
  ideaText: 'what survived after the fable window closed',
  tier: 'T1' as const,
};

describe('assembleDraftPrompt', () => {
  it('layers constitution, exemplars, idea, tier spec, and JSON contract in order', () => {
    const prompt = renderPrompt(assembleDraftPrompt(base));
    const order = [
      '## persona', 'lowercase, terse',
      '## playbook rules', '[structure] hook → story',
      '## exemplars', '1000 impressions',
      '## tier requirements', TIER_SPECS.T1.slice(0, 20),
      '## the idea', 'fable window closed',
      '## output contract', '"body_linkedin"',
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = prompt.indexOf(marker);
      expect(at, `missing or misordered: ${marker}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('omits the exemplars section when none were retrieved (degraded mode)', () => {
    const prompt = renderPrompt(assembleDraftPrompt({ ...base, exemplars: [] }));
    expect(prompt).not.toContain('## exemplars');
    expect(prompt).toContain('## the idea');
  });

  it('every tier has a spec and demands an image concept only for T1', () => {
    expect(TIER_SPECS.T1).toContain('image_concept');
    expect(TIER_SPECS.T1).not.toContain('image_brief');
    expect(TIER_SPECS.T2).not.toContain('image_brief');
    expect(TIER_SPECS.T3).not.toContain('image_brief');
  });

  it('T1 asks for image_concept, not an image_brief paragraph', () => {
    const p = renderPrompt(assembleDraftPrompt({ constitution: 'p', exemplars: [], ideaText: 'i', tier: 'T1' }));
    expect(p).toContain('image_concept');
    expect(p).not.toContain('image_brief field');
  });

  it('refinement inserts current draft + feedback between idea and output contract', () => {
    const prompt = renderPrompt(assembleDraftPrompt({
      ...base,
      refinement: { currentBody: 'the current body', feedback: 'tighten the middle' },
    }));
    const idea = prompt.indexOf('## the idea');
    const current = prompt.indexOf('## current draft');
    const feedback = prompt.indexOf('## feedback to apply');
    const contract = prompt.indexOf('## output contract');
    expect(idea).toBeGreaterThan(-1);
    expect(current).toBeGreaterThan(idea);
    expect(feedback).toBeGreaterThan(current);
    expect(contract).toBeGreaterThan(feedback);
    expect(renderPrompt(assembleDraftPrompt(base))).not.toContain('## current draft');
  });
});
