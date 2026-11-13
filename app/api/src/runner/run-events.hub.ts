import { Injectable } from '@nestjs/common';
import { EMPTY, Observable, ReplaySubject } from 'rxjs';
import type { EngineEvent } from '../engines/engine.interface';

@Injectable()
export class RunEventsHub {
  private readonly subjects = new Map<number, ReplaySubject<EngineEvent>>();

  private subject(runId: number): ReplaySubject<EngineEvent> {
    let s = this.subjects.get(runId);
    if (!s) { s = new ReplaySubject<EngineEvent>(100); this.subjects.set(runId, s); }
    return s;
  }

  /** Create the subject at run start so a subscriber arriving before the first event still replays. */
  open(runId: number): void { this.subject(runId); }

  emit(runId: number, event: EngineEvent): void { this.subject(runId).next(event); }

  complete(runId: number): void {
    this.subjects.get(runId)?.complete();
    // Keep for late subscribers briefly, then drop to avoid unbounded growth.
    setTimeout(() => this.subjects.delete(runId), 60_000).unref();
  }

  /** Never lazily creates: unknown/expired ids get a completed-empty stream so SSE closes cleanly. */
  stream(runId: number): Observable<EngineEvent> { return this.subjects.get(runId)?.asObservable() ?? EMPTY; }
}
