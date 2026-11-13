import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RuleCategorySchema, RuleStatusSchema } from '@forge/shared';
import { ZodBody } from '../common/zod-body.pipe';
import { parseQueryEnum } from '../common/query-parse';
import { PlaybookService } from './playbook.service';

const AddRuleSchema = z.object({
  category: RuleCategorySchema,
  rule: z.string().min(1),
  rationale: z.string().optional(),
});

@Controller('playbook')
export class PlaybookController {
  constructor(private readonly playbook: PlaybookService) {}

  @Get('rules')
  list(@Query('status') status?: string) {
    return this.playbook.listRules({
      status: status ? status.split(',').map((s) => parseQueryEnum(RuleStatusSchema, s, 'status')) : undefined,
    });
  }

  @Post('rules')
  add(@Body(new ZodBody(AddRuleSchema)) body: z.infer<typeof AddRuleSchema>) {
    return this.playbook.addRule(body); // provenance 'manual'
  }

  @Post('rules/:id/retire')
  retire(@Param('id', ParseIntPipe) id: number) {
    return this.playbook.retireRule(id);
  }
}
