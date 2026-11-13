import type { SplitPrompt } from '../engines/engine.interface';
import type { RuleRow } from './playbook.service';

export interface RetroPostInput {
  postId: number;
  tier: string;
  hook: string | null;
  body: string;
  metrics: {
    impressions: number; er: number; reactions: number; comments: number;
    shares: number; saves: number; followsGained: number | null;
  };
  demographicsSummary: string;
  activeRuleIds: number[];
}

export function assembleRetroPrompt(input: {
  constitution: string;
  goal: string;
  rules: Pick<RuleRow, 'id' | 'category' | 'rule' | 'rationale'>[];
  posts: RetroPostInput[];
}): SplitPrompt {
  const rules = input.rules
    .map((r) => `- [#${r.id} ${r.category}] ${r.rule}${r.rationale ? ` (why: ${r.rationale})` : ''}`)
    .join('\n');

  const postBlocks = input.posts.map((p) => [
    `### post ${p.postId} (${p.tier})`,
    `hook: ${p.hook ?? '(none)'}`,
    `body:\n${p.body}`,
    `metrics: ${p.metrics.impressions} impressions, ${p.metrics.er}% ER, ${p.metrics.reactions} reactions, ` +
      `${p.metrics.comments} comments, ${p.metrics.shares} shares, ${p.metrics.saves} saves, ` +
      `${p.metrics.followsGained ?? 0} follows gained`,
    `audience: ${p.demographicsSummary}`,
    `drafted under rules: ${p.activeRuleIds.join(', ') || '(none recorded)'}`,
  ].join('\n')).join('\n\n');

  const intro = [
    'you are running a retro on the operator\'s linkedin playbook.',
    'propose changes to the playbook rules based ONLY on evidence in the measured posts below.',
    'every proposal needs a data-backed rationale citing specific numbers or audience mix.',
    'prefer few high-confidence proposals over many speculative ones. propose nothing if the data is inconclusive.',
  ].join('\n');
  // The constitution closes the cached block; the goal, the rules and the posts are the user turn.
  return {
    system: [{ text: `${intro}\n\n${input.constitution}`, cache: true }],
    user: [
      '## the goal',
      input.goal,
      '',
      '## active playbook rules',
      rules || '(none yet)',
      '',
      '## measured posts',
      postBlocks,
      '',
      '## output contract',
      'return exactly this JSON shape. action is one of add|edit|retire.',
      'add: rule is the new text, target_rule_id null. edit: target_rule_id + full replacement text in rule.',
      'retire: target_rule_id, rule null. target_rule_id must reference an id listed above.',
      '{ "proposals": [ { "action": "add", "category": "voice|structure|visual|timing|cadence|platform",',
      '    "target_rule_id": null, "rule": "...", "rationale": "..." } ] }',
    ].join('\n'),
  };
}
