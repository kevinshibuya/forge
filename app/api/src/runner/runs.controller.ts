import { Controller, Param, ParseIntPipe, Sse, type MessageEvent } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { RunEventsHub } from './run-events.hub';

@Controller('runs')
export class RunsController {
  constructor(private readonly hub: RunEventsHub) {}

  @Sse(':id/events')
  events(@Param('id', ParseIntPipe) id: number): Observable<MessageEvent> {
    return this.hub.stream(id).pipe(
      map((e): MessageEvent => ({ data: e })),
    );
  }
}
