import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { RetroDecisionSchema, type RetroDecision } from '@forge/shared';
import { ZodBody } from '../common/zod-body.pipe';
import { RetroService } from './retro.service';

@Controller('retro')
export class RetroController {
  constructor(private readonly retro: RetroService) {}

  @Get('eligibility')
  eligibility() { return this.retro.eligibility(); }

  @Post('run')
  @HttpCode(202)
  async run() {
    const { runId, finished } = await this.retro.launchRetro();
    void finished;
    return { runId };
  }

  @Get('proposals/:runId')
  proposals(@Param('runId', ParseIntPipe) runId: number) {
    return this.retro.proposals(runId);
  }

  @Post('proposals/:runId/decide')
  decide(
    @Param('runId', ParseIntPipe) runId: number,
    @Body(new ZodBody(RetroDecisionSchema)) body: RetroDecision,
  ) {
    return this.retro.decide(runId, body.decisions);
  }
}
