import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsSchema } from './settings';
import { engagementRate } from './analytics';
import { RetroOutputSchema } from './retro';
import { PostStatusSchema, TierSchema } from './content';

describe('plan2 contracts', () => {
  it('settings gained docs + retro threshold, defaults still validate', () => {
    expect(() => SettingsSchema.parse(DEFAULT_SETTINGS)).not.toThrow();
    expect(DEFAULT_SETTINGS.personaDoc).toBe('');
    expect(DEFAULT_SETTINGS.retroEveryMeasured).toBe(3);
  });

  it('engagementRate = (reactions+comments+shares)/impressions as %, 0-safe', () => {
    expect(engagementRate({ reactions: 20, comments: 6, shares: 0, impressions: 1000 })).toBe(2.6);
    expect(engagementRate({ reactions: 5, comments: 0, shares: 0, impressions: 0 })).toBe(0);
  });

  it('retro proposals: add needs rule text, edit/retire need target id', () => {
    const p = (o: object) => RetroOutputSchema.safeParse({ proposals: [{ rationale: 'r', category: 'voice', target_rule_id: null, rule: null, ...o }] }).success;
    expect(p({ action: 'add', rule: 'new rule' })).toBe(true);
    expect(p({ action: 'add' })).toBe(false);
    expect(p({ action: 'retire', target_rule_id: 3 })).toBe(true);
    expect(p({ action: 'retire' })).toBe(false);
    expect(p({ action: 'edit', target_rule_id: 3, rule: 'edited' })).toBe(true);
    expect(p({ action: 'edit', target_rule_id: 3 })).toBe(false);
  });

  it('content enums match the db enums', () => {
    expect(PostStatusSchema.options).toEqual(['queued', 'drafting', 'draft_ready', 'approved', 'published', 'measured']);
    expect(TierSchema.options).toEqual(['T1', 'T2', 'T3']);
  });
});
