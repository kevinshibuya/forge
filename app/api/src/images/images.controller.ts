import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { AssetOriginSchema } from '@forge/shared';
import { ZodBody } from '../common/zod-body.pipe';
import { parseQueryEnum, parseQueryInt } from '../common/query-parse';
import { ImagesService } from './images.service';
import { ImageComposeService } from './image-compose.service';
import { ImageGenService } from './image-gen.service';
import { ImageRefineService } from './image-refine.service';
import { ImageReviewService } from './image-review.service';

const AssetSortSchema = z.enum(['newest', 'oldest']);

const BriefSchema = z.object({ brief: z.string().min(1) });
const InstructionSchema = z.object({ instruction: z.string().min(1) });
/** `bgRunId` names a finished bg-patch run whose background this save commits along with the edit. */
const EditedHtmlSchema = z.object({ html: z.string().min(1), bgRunId: z.number().int().positive().optional() });
const BatchBriefSchema = z.object({ brief: z.string().min(1), batch: z.number().int().min(1).max(10).optional() });

@Controller('images')
export class ImagesController {
  constructor(
    private readonly images: ImagesService,
    private readonly compose: ImageComposeService,
    private readonly gen: ImageGenService,
    private readonly refine: ImageRefineService,
    private readonly review: ImageReviewService,
  ) {}

  /**
   * Paged list. Bad param tokens are a 400 here; out-of-range limit/offset are clamped by the service.
   * `selected` rides along outside the page window so the hero survives paging and filtering.
   */
  @Get('posts/:postId')
  async list(
    @Param('postId', ParseIntPipe) postId: number,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sort') sort?: string,
    @Query('origin') origin?: string,
  ) {
    const [page, selected] = await Promise.all([
      this.images.listPage(postId, {
        ...(limit !== undefined ? { limit: parseQueryInt(limit, 'limit') } : {}),
        ...(offset !== undefined ? { offset: parseQueryInt(offset, 'offset') } : {}),
        ...(sort !== undefined ? { sort: parseQueryEnum(AssetSortSchema, sort, 'sort') } : {}),
        ...(origin !== undefined ? { origin: parseQueryEnum(AssetOriginSchema, origin, 'origin') } : {}),
      }),
      this.images.selectedFor(postId),
    ]);
    return { ...page, selected };
  }

  @Get('assets/:assetId/breakdown')
  breakdown(@Param('assetId', ParseIntPipe) assetId: number) {
    return this.images.breakdown(assetId);
  }

  @Post('posts/:postId/select/:assetId')
  async select(@Param('postId', ParseIntPipe) postId: number, @Param('assetId', ParseIntPipe) assetId: number) {
    await this.images.select(postId, assetId);
    return this.images.listForPost(postId);
  }

  @Delete('posts/:postId/:assetId')
  async remove(@Param('postId', ParseIntPipe) postId: number, @Param('assetId', ParseIntPipe) assetId: number) {
    await this.images.remove(postId, assetId);
    return this.images.listForPost(postId);
  }

  @Get(':id/file')
  async file(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const path = await this.images.pngPathFor(id);
    return new StreamableFile(createReadStream(path), { type: 'image/png' });
  }

  @Post('posts/:postId/html')
  @HttpCode(202)
  async html(@Param('postId', ParseIntPipe) postId: number, @Body(new ZodBody(BriefSchema)) body: z.infer<typeof BriefSchema>) {
    const launch = await this.compose.launchHtml(postId, body.brief);
    void launch.finished;
    return { runId: launch.runId };
  }

  @Post('posts/:postId/raster')
  @HttpCode(202)
  async raster(@Param('postId', ParseIntPipe) postId: number, @Body(new ZodBody(BatchBriefSchema)) body: z.infer<typeof BatchBriefSchema>) {
    const launch = await this.gen.launchRaster(postId, body.brief, body.batch);
    void launch.finished;
    return { runId: launch.runId };
  }

  @Post('posts/:postId/hybrid')
  @HttpCode(202)
  async hybrid(@Param('postId', ParseIntPipe) postId: number, @Body(new ZodBody(BatchBriefSchema)) body: z.infer<typeof BatchBriefSchema>) {
    const { runIds } = await this.compose.launchHybridBatch(postId, body.brief, body.batch);
    return { runIds };
  }

  /** Background-patch ONE candidate. 422 (with the reason) when the source can't be re-composited. */
  @Post('assets/:assetId/bg-patch')
  @HttpCode(202)
  async patchBackground(
    @Param('assetId', ParseIntPipe) assetId: number,
    @Body(new ZodBody(InstructionSchema)) body: z.infer<typeof InstructionSchema>,
  ) {
    const launch = await this.refine.launchBgPatch(assetId, body.instruction);
    void launch.finished;
    return { runId: launch.runId };
  }

  /** The patched background of a bg-patch run: 404 while it is still running, 422 when it failed. */
  @Get('runs/:runId/patched-bg')
  patchedBg(@Param('runId', ParseIntPipe) runId: number) {
    return this.refine.patchedBg(runId);
  }

  /** The candidate's html with its background inlined, for the canvas editor to load. */
  @Get('assets/:assetId/editable-html')
  editableHtml(@Param('assetId', ParseIntPipe) assetId: number) {
    return this.refine.editableHtml(assetId);
  }

  /**
   * Apply a canvas edit. Synchronous — no engine call, so the new candidate comes back on the
   * response rather than through a run the client would have to poll.
   */
  @Post('assets/:assetId/edit')
  applyEdit(
    @Param('assetId', ParseIntPipe) assetId: number,
    @Body(new ZodBody(EditedHtmlSchema)) body: z.infer<typeof EditedHtmlSchema>,
  ) {
    return this.refine.applyCanvasEdit(assetId, body.html, body.bgRunId);
  }

  @Post('posts/:postId/review')
  @HttpCode(202)
  async launchReview(@Param('postId', ParseIntPipe) postId: number) {
    const launch = await this.review.launchReview(postId);
    void launch.finished;
    return { runId: launch.runId };
  }
}
