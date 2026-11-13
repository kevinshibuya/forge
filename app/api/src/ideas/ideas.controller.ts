import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { IdeaSourceSchema, IdeaStatusSchema, TierSchema } from '@forge/shared';
import { ZodBody } from '../common/zod-body.pipe';
import { parseQueryEnum, parseQueryInt } from '../common/query-parse';
import { IdeasService } from './ideas.service';

const CreateSchema = z.object({ rawText: z.string().min(1), source: IdeaSourceSchema.default('braindump') });
const PatchSchema = z.object({
  rawText: z.string().trim().min(1).optional(),
  notes: z.string().optional(),
  suggestedTier: TierSchema.optional(),
  newsExpiry: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum(['new', 'discarded']).optional(),
});
const PromoteSchema = z.object({
  tier: TierSchema,
});

@Controller('ideas')
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  @Post()
  create(@Body(new ZodBody(CreateSchema)) body: z.infer<typeof CreateSchema>) {
    return this.ideas.create(body);
  }

  @Get()
  list(@Query('status') status?: string, @Query('promotedPostId') promotedPostId?: string) {
    return this.ideas.list({
      status: status ? status.split(',').map((s) => parseQueryEnum(IdeaStatusSchema, s, 'status')) : undefined,
      promotedPostId: promotedPostId ? parseQueryInt(promotedPostId, 'promotedPostId') : undefined,
    });
  }

  @Patch(':id')
  patch(@Param('id', ParseIntPipe) id: number, @Body(new ZodBody(PatchSchema)) body: z.infer<typeof PatchSchema>) {
    const { newsExpiry, ...rest } = body;
    return this.ideas.patch(id, {
      ...rest,
      ...(newsExpiry !== undefined ? { newsExpiry: newsExpiry ? new Date(newsExpiry) : null } : {}),
    });
  }

  @Post(':id/triage')
  triage(@Param('id', ParseIntPipe) id: number) {
    return this.ideas.triage(id);
  }

  @Post(':id/promote')
  promote(@Param('id', ParseIntPipe) id: number, @Body(new ZodBody(PromoteSchema)) body: z.infer<typeof PromoteSchema>) {
    return this.ideas.promote(id, { tier: body.tier });
  }
}
