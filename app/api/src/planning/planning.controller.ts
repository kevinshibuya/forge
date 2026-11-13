import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { PlanningService } from './planning.service';

@Controller()
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get('dashboard')
  dashboard() { return this.planning.dashboard(); }

  /**
   * Two shapes on one route. `from`+`to` (inclusive ISO days, optional `month` anchor for the
   * mini-month) serves the agenda stream; `date` alone — any day in the wanted week/month — keeps
   * the legacy week-shaped payload. Exactly one of `from`/`to` is a 400.
   */
  @Get('planner')
  planner(
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('month') month?: string,
  ) {
    if (from === undefined && to === undefined) return this.planning.plannerData(date);
    if (from === undefined || to === undefined) {
      throw new BadRequestException('planner range: `from` and `to` must both be present');
    }
    return this.planning.plannerStream({ from, to, month });
  }
}
