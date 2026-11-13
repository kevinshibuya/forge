import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { RunKindSchema, RunStatusSchema } from '@forge/shared';
import { parseQueryEnum, parseQueryInt } from '../common/query-parse';
import { type RunStepDto, toRunStepDto } from './run-step.dto';
import { RunsService, type RunRow } from './runs.service';

export type RunDetailDto = Omit<RunRow, 'costUsd'> & {
  steps: RunStepDto[];
  /** Recorded at call time from the registry row; a managed run's is the sum of its steps. */
  costUsd: number | null;
};

@Controller('runs')
export class RunsLogController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  list(
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('postId') postId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.runs.list({
      kind: kind ? parseQueryEnum(RunKindSchema, kind, 'kind') : undefined,
      status: status ? parseQueryEnum(RunStatusSchema, status, 'status') : undefined,
      postId: postId ? parseQueryInt(postId, 'postId', { min: 1 }) : undefined,
      limit: limit ? parseQueryInt(limit, 'limit', { min: 1, max: 200 }) : undefined,
    });
  }

  /** One run plus its engine sub-calls. */
  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number): Promise<RunDetailDto> {
    const [row, steps] = await Promise.all([this.runs.get(id), this.runs.stepsFor(id)]);
    return { ...row, steps: steps.map(toRunStepDto) };
  }
}
