import { Module } from '@nestjs/common';
import { ENGINE_BACKEND, ENGINES } from './engine.interface';
import { installedEngines } from './installed';

/** Provides what the entry file installed. It constructs no engine itself; a spec overrides
 *  `ENGINES` (and `ENGINE_BACKEND` when it needs `api`) with its doubles. */
@Module({
  providers: [
    { provide: ENGINES, useFactory: () => installedEngines().engines },
    { provide: ENGINE_BACKEND, useFactory: () => installedEngines().backend },
  ],
  exports: [ENGINES, ENGINE_BACKEND],
})
export class EnginesModule {}
