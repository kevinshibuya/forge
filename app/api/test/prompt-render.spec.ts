import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_LINE, renderPrompt, type StyleDoc, type TextRunKind } from '@forge/shared';
import type { SplitPrompt } from '../src/engines/engine.interface';
import { assembleConstitution } from '../src/retrieval/constitution';
import { assembleDraftPrompt } from '../src/retrieval/prompt-assembly';
import { assembleTriagePrompt } from '../src/ideas/triage-prompt';
import { assembleRetroPrompt } from '../src/playbook/retro-prompt';
import { assemblePlanPrompt, assembleVariatorPrompt } from '../src/images/hybrid-prompts';
import { buildRefineSelectionPrompt } from '../src/drafting/drafting.service';

/**
 * Byte identity across the system/user split (slice 2, B6). The fixtures were written by the
 * pre-split string builders; every builder's rendered split must equal its fixture exactly. A byte
 * difference is the red. `WRITE_PROMPT_FIXTURES=1` rewrites them, which is only ever right against
 * builders whose output is known good.
 */
const FIXTURES = join(__dirname, 'fixtures/prompts');
const WRITE = process.env.WRITE_PROMPT_FIXTURES === '1';

function matches(name: string, built: SplitPrompt): void {
  const path = join(FIXTURES, name);
  if (WRITE) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(path, renderPrompt(built));
  }
  expect(renderPrompt(built)).toBe(readFileSync(path, 'utf8'));
  // The cache breakpoint sits after the constitution: one cached system block that ends with it,
  // and a user turn that does not repeat it (ADR 0019).
  expect(built.system).toHaveLength(1);
  expect(built.system[0]!.cache).toBe(true);
  expect(built.system[0]!.text.endsWith(CONSTITUTION_TAIL)).toBe(true);
  expect(built.user).not.toContain(CONSTITUTION_TAIL);
}

/** Every constitution closes on the contract line, so a cached block that ends with it ends with
 *  the constitution. */
const CONSTITUTION_TAIL = CONTRACT_LINE;

const STYLE: StyleDoc = { id: 'house', name: 'house style', body: 'short sentences.', enabled: true, excludedKinds: [] };
const constitution = (kind: TextRunKind) => assembleConstitution({
  kind, settings: { personaDoc: 'p', styleDocs: [STYLE] }, rules: [{ category: 'voice', rule: 'say the number' }],
});

describe('rendered prompts are byte-identical to the pre-split builders', () => {
  it('draft, T1, two exemplars (one with a performance note) and a refinement', () => {
    matches('draft-t1-refine.txt', assembleDraftPrompt({
      constitution: constitution('draft'),
      exemplars: [
        { sourceType: 'post', sourceId: 1, chunkText: 'the first exemplar', similarity: 0.91, performanceNote: '4.2% ER' },
        { sourceType: 'idea', sourceId: 2, chunkText: 'the second exemplar', similarity: 0.5 },
      ],
      ideaText: 'the idea',
      tier: 'T1',
      refinement: { currentBody: 'the current body', feedback: 'shorter' },
    }));
  });

  it('draft, T2, no exemplars and no refinement', () => {
    matches('draft-t2-plain.txt', assembleDraftPrompt({
      constitution: constitution('draft'), exemplars: [], ideaText: 'the idea', tier: 'T2',
    }));
  });

  it('triage', () => {
    matches('triage.txt', assembleTriagePrompt(constitution('triage'), 'a raw idea'));
  });

  it('retro', () => {
    matches('retro.txt', assembleRetroPrompt({
      constitution: constitution('retro'),
      goal: 'the goal',
      rules: [{ id: 7, category: 'voice', rule: 'say the number', rationale: 'it lands' }],
      posts: [{
        postId: 1, tier: 'T1', hook: null, body: 'the body',
        metrics: { impressions: 1000, er: 4.2, reactions: 30, comments: 5, shares: 2, saves: 1, followsGained: null },
        demographicsSummary: 'engineers', activeRuleIds: [7],
      }],
    }));
  });

  it('hybrid plan, with a reference', () => {
    matches('plan.txt', assemblePlanPrompt(constitution('image_plan'), 'the brief', 'the design language', '/abs/bg.png'));
  });

  it('variator', () => {
    matches('variator.txt', assembleVariatorPrompt(constitution('image_variate'), 'the brief', 3));
  });

  it('refine selection', () => {
    matches('refine-selection.txt', buildRefineSelectionPrompt(constitution('refine_selection'), 'one two three', 4, 7, 'make it louder'));
  });
});
