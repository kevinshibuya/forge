import { z } from 'zod';

export const AssetLaneSchema = z.enum(['html', 'raster', 'hybrid']);
export type AssetLane = z.infer<typeof AssetLaneSchema>;

/** How an asset came to be: fresh generation, a background refine, or a canvas edit. */
export const AssetOriginSchema = z.enum(['generated', 'bg_refined', 'canvas_edited']);
export type AssetOrigin = z.infer<typeof AssetOriginSchema>;

/** image_html / hybrid runs return a single self-contained HTML document. */
export const ImageHtmlOutputSchema = z.object({ html: z.string().min(1) });
export type ImageHtmlOutput = z.infer<typeof ImageHtmlOutputSchema>;

/** image_review scores each candidate by its asset id, 0-100, with a short note. */
export const ImageReviewOutputSchema = z.object({
  scores: z.array(z.object({
    assetId: z.number().int(),
    score: z.number().int().min(0).max(100),
    notes: z.string(),
  })),
});
export type ImageReviewOutput = z.infer<typeof ImageReviewOutputSchema>;

/** hybrid composition plan: an art-director JSON produced up front by claude. */
export const HybridPlanSchema = z.object({
  backgroundPrompt: z.string().min(1),
  headline: z.string().min(1),
  subtext: z.string().optional(),
  textZone: z.enum(['lower-third', 'upper-third', 'left-half', 'right-half', 'center']),
  palette: z.string().min(1),
  /** what worked in the reference image (direction, not a template) — plan step fills this only when a reference is attached. */
  refLearnings: z.string().optional(),
});
export type HybridPlan = z.infer<typeof HybridPlanSchema>;

/** variator output: N distinct visual directions for one brief (batch diversity).
 *  Object-wrapped — extractJson (runner.service.ts) extracts {...} only, never a bare array. */
export const HybridDirectionsSchema = z.object({ directions: z.array(z.string().trim().min(1)).min(1) });
export type HybridDirections = z.infer<typeof HybridDirectionsSchema>;
