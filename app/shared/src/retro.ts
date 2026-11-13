import { z } from 'zod';
import { RuleCategorySchema } from './content';

export const RetroProposalSchema = z.object({
  action: z.enum(['add', 'edit', 'retire']),
  category: RuleCategorySchema,
  target_rule_id: z.number().int().positive().nullable(),
  rule: z.string().min(1).nullable(),
  rationale: z.string().min(1),
}).superRefine((p, ctx) => {
  if ((p.action === 'add' || p.action === 'edit') && !p.rule) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.action} proposal needs rule text` });
  }
  if ((p.action === 'edit' || p.action === 'retire') && p.target_rule_id == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.action} proposal needs target_rule_id` });
  }
});
export type RetroProposal = z.infer<typeof RetroProposalSchema>;

export const RetroOutputSchema = z.object({ proposals: z.array(RetroProposalSchema) });
export type RetroOutput = z.infer<typeof RetroOutputSchema>;

export const RetroDecisionSchema = z.object({
  decisions: z.array(z.object({ index: z.number().int().nonnegative(), approved: z.boolean() })).min(1),
});
export type RetroDecision = z.infer<typeof RetroDecisionSchema>;
