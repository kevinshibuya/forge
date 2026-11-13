import { z } from 'zod';

export const TierSchema = z.enum(['T1', 'T2', 'T3']);
export const PostStatusSchema = z.enum(['queued', 'drafting', 'draft_ready', 'approved', 'published', 'measured']);
export type PostStatus = z.infer<typeof PostStatusSchema>;
export const IdeaSourceSchema = z.enum(['work', 'news', 'evergreen', 'braindump']);
export type IdeaSource = z.infer<typeof IdeaSourceSchema>;
export const IdeaStatusSchema = z.enum(['new', 'triaged', 'promoted', 'discarded']);
export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;
export const RuleCategorySchema = z.enum(['voice', 'structure', 'visual', 'timing', 'cadence', 'platform']);
export type RuleCategory = z.infer<typeof RuleCategorySchema>;
export const RuleStatusSchema = z.enum(['active', 'retired']);
export type RuleStatus = z.infer<typeof RuleStatusSchema>;
