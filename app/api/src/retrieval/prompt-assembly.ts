import type { SplitPrompt } from '../engines/engine.interface';
import type { Exemplar } from './retrieval.service';

export interface ExemplarInput extends Exemplar { performanceNote?: string }

export const TIER_SPECS: Record<'T1' | 'T2' | 'T3', string> = {
  T1: [
    'flagship post: full story arc. emotional hook, scarcity/tension story,',
    'a compact block of supporting substance (prose by default; a short bullet list',
    'only when the content is genuinely a list), aphorism close, engagement question.',
    'include an image_concept field: 1-2 sentences naming the core inversion/idea',
    'a branded image should carry. the concept only, no visual spec.',
  ].join(' '),
  T2: [
    'insight post: a strong text-only lesson, opinion, or mini-story.',
    'tighter than a flagship: one idea argued well, no image.',
  ].join(' '),
  T3: [
    'spark post: a short take, sharp question, or observation designed to',
    'invite replies. under 600 characters. no image.',
  ].join(' '),
};

export function assembleDraftPrompt(input: {
  /** The assembled block from assembleConstitution: persona, rules, style docs, contract lines. */
  constitution: string;
  exemplars: ExemplarInput[];
  ideaText: string;
  tier: 'T1' | 'T2' | 'T3';
  refinement?: { currentBody: string; feedback: string };
}): SplitPrompt {
  const { constitution, exemplars, ideaText, tier, refinement } = input;

  const refinementBlock = !refinement ? '' : [
    '## current draft',
    refinement.currentBody,
    '',
    '## feedback to apply',
    refinement.feedback,
    '',
    'revise the current draft by applying the feedback. keep what already works; only restart from scratch if the feedback demands it.',
    '',
  ].join('\n');

  const exemplarBlock = exemplars.length === 0 ? '' : [
    '## exemplars',
    'similar past material and how it performed. match what worked; do not copy phrasing.',
    ...exemplars.map((e, i) => [
      `### exemplar ${i + 1} (${e.sourceType}, similarity ${e.similarity.toFixed(2)}${e.performanceNote ? `, ${e.performanceNote}` : ''})`,
      e.chunkText,
    ].join('\n')),
    '',
  ].join('\n');

  // The constitution is the same for every Post, so it closes the cached block; the exemplars and
  // the idea change per Post and ride in the user turn (ADR 0019).
  return {
    system: [{ text: `you are drafting a linkedin post for the operator.\n\n${constitution}`, cache: true }],
    user: [
      exemplarBlock,
      '## tier requirements',
      `tier ${tier}: ${TIER_SPECS[tier]}`,
      '',
      '## the idea',
      ideaText,
      '',
      refinementBlock,
      '## output contract',
      'return exactly this JSON shape:',
      '{ "body_linkedin": "full post text", "hashtags": ["#..."], "image_concept": "only for T1" }',
    ].join('\n'),
  };
}
