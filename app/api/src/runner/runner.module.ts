import { Module } from '@nestjs/common';
import { EnginesModule } from '../engines/engines.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ModelRegistryModule } from '../registry/model-registry.module';
import { RunsModule } from '../runs/runs.module';
import { SettingsModule } from '../settings/settings.module';
import { RunEventsHub } from './run-events.hub';
import { RunnerService } from './runner.service';
import { RunsController } from './runs.controller';

@Module({
  imports: [EnginesModule, RunsModule, SettingsModule, ModelRegistryModule, LedgerModule],
  providers: [RunnerService, RunEventsHub],
  controllers: [RunsController],
  exports: [RunnerService, RunEventsHub],
})
export class RunnerModule {}
