import { z } from 'zod';

export const DemoRowSchema = z.object({ value: z.string().min(1), percent: z.number().min(0).max(100) });
export type DemoRow = z.infer<typeof DemoRowSchema>;

export const DemographicsSchema = z.object({
  jobTitles: z.array(DemoRowSchema),
  locations: z.array(DemoRowSchema),
  seniority: z.array(DemoRowSchema),
  companies: z.array(DemoRowSchema),
  industries: z.array(DemoRowSchema),
  companySizes: z.array(DemoRowSchema),
});
export type Demographics = z.infer<typeof DemographicsSchema>;

/** Engagement rate as a percentage with 2 decimals: (reactions+comments+shares)/impressions. */
export function engagementRate(s: { reactions: number; comments: number; shares: number; impressions: number }): number {
  if (s.impressions === 0) return 0;
  return Math.round(((s.reactions + s.comments + s.shares) / s.impressions) * 10000) / 100;
}
