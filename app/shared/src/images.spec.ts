import { describe, expect, it } from 'vitest';
import {
  AssetLaneSchema, HybridPlanSchema, HybridDirectionsSchema, ImageHtmlOutputSchema, ImageReviewOutputSchema,
} from './images';

describe('image contracts', () => {
  it('accepts the three lanes and rejects others', () => {
    expect(AssetLaneSchema.parse('html')).toBe('html');
    expect(AssetLaneSchema.parse('raster')).toBe('raster');
    expect(AssetLaneSchema.parse('hybrid')).toBe('hybrid');
    expect(() => AssetLaneSchema.parse('gif')).toThrow();
  });

  it('parses image_html output', () => {
    expect(ImageHtmlOutputSchema.parse({ html: '<div>x</div>' }).html).toContain('div');
    expect(() => ImageHtmlOutputSchema.parse({ html: '' })).toThrow();
  });

  it('parses image_review output and clamps score range', () => {
    const ok = ImageReviewOutputSchema.parse({ scores: [{ assetId: 3, score: 88, notes: 'sharp' }] });
    expect(ok.scores[0]!.assetId).toBe(3);
    expect(() => ImageReviewOutputSchema.parse({ scores: [{ assetId: 1, score: 130, notes: 'x' }] })).toThrow();
  });

  it('accepts a valid hybrid plan and rejects a malformed one', () => {
    const ok = HybridPlanSchema.parse({ backgroundPrompt: 'deep navy gradient', headline: 'The Idle Transaction', textZone: 'lower-third', palette: 'navy/teal' });
    expect(ok.headline).toBe('The Idle Transaction');
    expect(ok.subtext).toBeUndefined();
    expect(() => HybridPlanSchema.parse({ headline: 'x' })).toThrow();
    expect(() => HybridPlanSchema.parse({ ...ok, textZone: 'diagonal' })).toThrow();
  });

  it('HybridPlanSchema accepts optional refLearnings', () => {
    const plan = HybridPlanSchema.parse({
      backgroundPrompt: 'deep navy gradient', headline: 'The Idle Transaction',
      textZone: 'lower-third', palette: 'navy/teal', refLearnings: 'thin 3px line work, single blue accent',
    });
    expect(plan.refLearnings).toBe('thin 3px line work, single blue accent');
    expect(HybridPlanSchema.parse({
      backgroundPrompt: 'x', headline: 'y', textZone: 'center', palette: 'z',
    }).refLearnings).toBeUndefined();
  });

  it('HybridDirectionsSchema parses { directions: [...] } and rejects empties', () => {
    // OBJECT contract, not a bare array: RunnerService's extractJson only extracts {...}
    // (runner.service.ts:13-20) — a bare array would ALWAYS fail parse (plan pre-review C1).
    expect(HybridDirectionsSchema.parse({ directions: ['a', 'b'] }).directions).toEqual(['a', 'b']);
    expect(() => HybridDirectionsSchema.parse({ directions: [] })).toThrow();
    expect(() => HybridDirectionsSchema.parse({ directions: ['a', ''] })).toThrow();
    // A blank-but-not-empty direction is worse than no direction: it passes the truthiness test at
    // the call site and hands the plan step "supersede the brief's visuals with <nothing>".
    expect(() => HybridDirectionsSchema.parse({ directions: ['a', '   '] })).toThrow();
    expect(HybridDirectionsSchema.parse({ directions: ['  padded  '] }).directions).toEqual(['padded']);
    expect(() => HybridDirectionsSchema.parse(['a', 'b'])).toThrow();
  });
});
