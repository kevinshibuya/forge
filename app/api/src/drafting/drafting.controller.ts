import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { DraftingService } from './drafting.service';

/** Research is gone from every launcher until slice 9. The field stays in the schema only as
 *  `false`, so a stale tab that still sends `research: true` gets a 400 instead of a plain draft
 *  it did not ask for. An absent body still means a draft. */
const NoResearch = z.literal(false).optional();
export const DraftBodySchema = z.object({ research: NoResearch }).default({});
const RefineSchema = z.object({ feedback: z.string().min(1), research: NoResearch });
const RefineSelectionSchema = z.object({
  selectionStart: z.number().int().nonnegative(),
  selectionEnd: z.number().int().nonnegative(),
  instruction: z.string().min(1),
  research: NoResearch,
});

@Controller('posts')
export class DraftingController {
  constructor(private readonly drafting: DraftingService) {}

  @Post(':id/draft')
  @HttpCode(202)
  async draft(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(DraftBodySchema)) _body: z.infer<typeof DraftBodySchema>,
  ) {
    const launch = await this.drafting.launchDraft(id);
    void launch.finished;
    return { runId: launch.runId, degraded: launch.degraded };
  }

  @Post(':id/refine')
  @HttpCode(202)
  async refine(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(RefineSchema)) body: z.infer<typeof RefineSchema>,
  ) {
    const launch = await this.drafting.launchRefine(id, body.feedback);
    void launch.finished;
    return { runId: launch.runId, degraded: launch.degraded };
  }

  @Post(':id/refine-selection')
  @HttpCode(202)
  async refineSelection(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(RefineSelectionSchema)) body: z.infer<typeof RefineSelectionSchema>,
  ) {
    // `finished` stays server-side: the client polls the run, as it always has.
    const { selectionStart, selectionEnd, instruction } = body;
    const { runId } = await this.drafting.launchRefineSelection(id, { selectionStart, selectionEnd, instruction });
    return { runId };
  }

  @Get(':id/refine-selection/:runId')
  refineSelectionProposal(
    @Param('id', ParseIntPipe) id: number,
    @Param('runId', ParseIntPipe) runId: number,
  ) {
    return this.drafting.getRefineSelectionProposal(id, runId);
  }
}
