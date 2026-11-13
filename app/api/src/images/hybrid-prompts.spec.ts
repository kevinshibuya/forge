import { describe, it, expect } from 'vitest';
import type { HybridPlan } from '@forge/shared';
import { lintTells, renderPrompt } from '@forge/shared';
import { assembleConstitution } from '../retrieval/constitution';
import { assemblePlanPrompt, assembleBackgroundPrompt, hybridTextBrief, assembleVariatorPrompt } from './hybrid-prompts';

/** A real constitution, so the assertions see what the model will see. */
const constitutionFor = (kind: 'image_plan' | 'image_variate') => assembleConstitution({
  kind,
  settings: { personaDoc: 'lowercase, terse.', styleDocs: [{ id: 'unslop', name: 'unslop', body: 'no hype.', enabled: true, excludedKinds: [] }] },
  rules: [],
});

describe('hybrid prompts', () => {
  it('plan prompt carries brief + design language and asks for JSON', () => {
    const p = renderPrompt(assemblePlanPrompt(constitutionFor('image_plan'), 'senior hiring', 'BRAND DOC'));
    expect(p).toContain('senior hiring'); expect(p).toContain('BRAND DOC'); expect(p.toLowerCase()).toContain('json');
  });
  it('background prompt keeps the zone calm, forbids text, names bg.png', () => {
    const bg = renderPrompt(assembleBackgroundPrompt({ backgroundPrompt: 'navy gradient', headline: 'H', textZone: 'lower-third', palette: 'navy' }));
    expect(bg).toContain('navy gradient'); expect(bg).toContain('lower-third');
    expect(bg.toLowerCase()).toContain('no text'); expect(bg.toLowerCase()).toContain('bg.png');
  });
  it('text brief surfaces headline + zone + subtext', () => {
    const t = hybridTextBrief({ backgroundPrompt: 'x', headline: 'The Idle Transaction', subtext: 'why', textZone: 'lower-third', palette: 'navy' });
    expect(t).toContain('The Idle Transaction'); expect(t).toContain('lower-third'); expect(t).toContain('why');
  });
});

describe('reference-aware prompts', () => {
  const plan = { backgroundPrompt: 'ink field', headline: 'H', textZone: 'lower-third', palette: 'dark ink' } as HybridPlan;

  it('background prompt gains the style-direction block only when asked', () => {
    const withRef = renderPrompt(assembleBackgroundPrompt(plan, true));
    expect(withRef).toContain('Style direction distilled from a previous winning image');
    expect(withRef).toContain('compose the scene fresh');
    expect(withRef).toContain('NO text');
    expect(withRef).not.toContain('Image 1');
    expect(renderPrompt(assembleBackgroundPrompt(plan))).not.toContain('Style direction');
  });

  it('plan prompt instructs Reading the reference and aligning textZone/palette', () => {
    const p = renderPrompt(assemblePlanPrompt(constitutionFor('image_plan'), 'brief', 'doc', '/refs/bg.png'));
    expect(p).toContain('/refs/bg.png');
    expect(p).toContain('Read');
    expect(p).toContain('consistent with it');
    expect(renderPrompt(assemblePlanPrompt(constitutionFor('image_plan'), 'brief', 'doc'))).not.toContain('reference');
  });
});

describe('variator + reference-as-direction prompts', () => {
  it('variator prompt demands n distinct visuals-only directions as a JSON array', () => {
    const p = renderPrompt(assembleVariatorPrompt(constitutionFor('image_variate'), 'my brief', 4));
    expect(p).toContain('my brief');
    expect(p).toContain('4 DISTINCT visual directions');
    expect(p).toContain('"directions"');
    expect(p).toContain('exactly 4 strings');
    // The JSON example is a strong attractor for output shape: a fixed 2-element example next to
    // "exactly 4 strings" invites a 2-direction reply, silently degrading slots 3-4 to the plain brief.
    expect(p).toContain('"direction 4"');
    expect(renderPrompt(assembleVariatorPrompt(constitutionFor('image_variate'), 'my brief', 2))).not.toContain('"direction 3"');
    expect(p).toContain('VISUALS ONLY');
    expect(p).toContain('REINVENTS the visual metaphor');
    expect(p).toContain('not a contract');
    expect(p).toContain('free to discard and replace');
    expect(p).toContain('Never alter, rephrase, or extend');
  });

  it('plan and variator prompts carry the constitution, no rules block, and no em dash', () => {
    const plan = renderPrompt(assemblePlanPrompt(constitutionFor('image_plan'), 'a dash free brief', 'a dash free doc'));
    const variator = renderPrompt(assembleVariatorPrompt(constitutionFor('image_variate'), 'a dash free brief', 3));
    for (const prompt of [plan, variator]) {
      expect(prompt).toContain('## persona');
      expect(prompt).toContain('## style: unslop');
      expect(prompt).not.toContain('## playbook rules');
      expect(lintTells(prompt).filter((t) => t.id === 'em-dash')).toEqual([]);
    }
  });

  it('plan prompt with a reference extracts refLearnings and forbids copying composition', () => {
    const p = renderPrompt(assemblePlanPrompt(constitutionFor('image_plan'), 'b', 'doc', '/abs/bg.png'));
    expect(p).toContain('/abs/bg.png');
    expect(p).toContain('DIRECTION, not a template');
    expect(p).toContain('refLearnings');
    expect(p).toContain('must NOT copy the reference');
    expect(p).not.toContain('reproduce its look');
  });

  it('plan prompt without a reference has no refLearnings field', () => {
    expect(renderPrompt(assemblePlanPrompt(constitutionFor('image_plan'), 'b', 'doc'))).not.toContain('refLearnings');
  });

  it('background prompt carries reference learnings as style-only text, no attached-image language', () => {
    const plan = { backgroundPrompt: 'bp', headline: 'h', textZone: 'lower-third' as const, palette: 'p', refLearnings: 'thin lines, one accent' };
    const withRef = renderPrompt(assembleBackgroundPrompt(plan, true));
    expect(withRef).toContain('Carry over what worked: thin lines, one accent');
    expect(withRef).toContain('compose the scene fresh');
    expect(withRef).not.toContain('Image 1');
    const noLearnings = renderPrompt(assembleBackgroundPrompt({ ...plan, refLearnings: undefined }, true));
    expect(noLearnings).toContain('Style direction distilled');
    expect(noLearnings).not.toContain('carry over what worked');
    expect(renderPrompt(assembleBackgroundPrompt(plan, false))).not.toContain('Style direction');
  });
});
