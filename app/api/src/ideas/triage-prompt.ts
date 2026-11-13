import type { SplitPrompt } from '../engines/engine.interface';

export function assembleTriagePrompt(constitution: string, rawText: string): SplitPrompt {
  return {
    system: [{ text: `you are triaging a raw content idea for the operator's linkedin pipeline.\n\n${constitution}`, cache: true }],
    user: [
      '## classification',
      'source (pick one):',
      '- work: something kevin built, shipped, debugged, or measured himself',
      '- news: a reaction to an external AI/tech event; goes stale',
      '- evergreen: a lesson or opinion that stays true',
      '- braindump: fragment that needs shaping before it fits elsewhere',
      '',
      'suggested_tier (pick one):',
      '- T1: flagship, carries a full story arc and deserves a branded image',
      '- T2: insight, one strong idea argued well, text-only',
      '- T3: spark, short take or question designed to invite replies',
      '',
      'news_expiry_days: integer days until this stops being worth posting; null unless source is news.',
      'notes: 1-2 sentences on the angle you would take and why it serves the audience the goal names.',
      '',
      '## the idea',
      rawText,
      '',
      '## output contract',
      'return exactly this JSON shape (news_expiry_days is an integer for news, null otherwise):',
      '{ "source": "work|news|evergreen|braindump", "suggested_tier": "T1|T2|T3", "news_expiry_days": null, "notes": "..." }',
    ].join('\n'),
  };
}
