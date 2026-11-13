import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { RunsLogController } from './runs-log.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [SettingsModule],
  controllers: [RunsLogController],
  providers: [RunsService],
  exports: [RunsService],
})
export class RunsModule {}
