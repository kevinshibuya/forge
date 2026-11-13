import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { PostStatusSchema, SourceSchema } from '@forge/shared';
import { ZodBody } from '../common/zod-body.pipe';
import { parseQueryEnum } from '../common/query-parse';
import { PostsService } from './posts.service';

const PatchMetaSchema = z.object({
  hook: z.string().min(1).optional(),
  imagePrompt: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  topicTags: z.array(z.string()).optional(),
});
/**
 * At least one of body or sources. `sourceRunId` names the refine run whose proposal is being
 * accepted: it attributes the revision AND appends that run's Sources, so unlike before it must
 * name a real succeeded run on this post or the save is a 404.
 */
export const BodySchema = z.object({
  body: z.string().min(1).optional(),
  sources: z.array(SourceSchema).optional(),
  sourceRunId: z.number().int().positive().optional(),
})
  .refine((b) => b.body !== undefined || b.sources !== undefined, { message: 'body or sources is required' })
  // An explicit list wins over the run's append, so accepting both would 404-validate the run,
  // discard what it returned, and still stamp the revision `run:<id>`: a revision claiming a run
  // wrote Sources it never returned. Refuse the pair rather than resolve it silently.
  .refine((b) => b.sources === undefined || b.sourceRunId === undefined, {
    message: 'sources and sourceRunId cannot be sent together',
  });
const PublishSchema = z.object({
  linkedinUrl: z.string().url(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
});
const ReferenceSchema = z.object({ assetId: z.number().int().positive().nullable() });
// .strict() is load-bearing: it rejects `{ date: null, time }` (unschedule carries no time)
const ScheduleSchema = z.union([
  // the time regex bounds the clock face itself: '24:00' is a valid luxon end-of-day and a valid
  // PG `time`, but it is not a wall-clock a chip can render — reject it at the edge, as a 400.
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }).strict(),
  z.object({ date: z.null() }).strict(),
]);
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(@Query('status') status?: string) {
    const parsed = status ? status.split(',').map((s) => parseQueryEnum(PostStatusSchema, s, 'status')) : undefined;
    return this.posts.list({ status: parsed });
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.posts.detail(id);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(PatchMetaSchema)) body: z.infer<typeof PatchMetaSchema>,
  ) {
    return this.posts.patchMeta(id, body);
  }

  @Patch(':id/schedule')
  setSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(ScheduleSchema)) body: z.infer<typeof ScheduleSchema>,
  ) {
    // full-state: an omitted time clears any stored time
    return this.posts.setSchedule(id, body.date === null ? null : { date: body.date, time: body.time ?? null });
  }

  @Post(':id/body')
  async updateBody(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(BodySchema)) body: z.infer<typeof BodySchema>,
  ) {
    await this.posts.updateBody(id, {
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.sources !== undefined ? { sources: body.sources } : {}),
      ...(body.sourceRunId !== undefined ? { appendFromRunId: body.sourceRunId } : {}),
      source: body.sourceRunId ? `run:${body.sourceRunId}` : 'manual_edit',
    });
    return this.posts.detail(id);
  }

  @Post(':id/approve')
  async approve(@Param('id', ParseIntPipe) id: number) {
    await this.posts.approve(id);
    return this.posts.get(id);
  }

  @Post(':id/publish')
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(PublishSchema)) body: z.infer<typeof PublishSchema>,
  ) {
    await this.posts.publish(id, {
      linkedinUrl: body.linkedinUrl,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    });
    return this.posts.get(id);
  }

  @Post(':id/revisions/:revId/restore')
  async restore(@Param('id', ParseIntPipe) id: number, @Param('revId', ParseIntPipe) revId: number) {
    await this.posts.restoreRevision(id, revId);
    return this.posts.detail(id);
  }

  @Patch(':id/reference')
  setReference(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(ReferenceSchema)) body: z.infer<typeof ReferenceSchema>,
  ) {
    return this.posts.setReference(id, body.assetId);
  }

  @Get(':id/reference-candidates')
  referenceCandidates(@Param('id', ParseIntPipe) id: number) {
    return this.posts.referenceCandidates(id);
  }

  /** 200 with an empty body, the shape DELETE /posts/:postId/inputs/:inputId already has. */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.posts.remove(id);
  }
}
