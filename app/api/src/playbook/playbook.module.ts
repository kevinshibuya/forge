import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PostsModule } from '../posts/posts.module';
import { RunnerModule } from '../runner/runner.module';
import { RunsModule } from '../runs/runs.module';
import { SettingsModule } from '../settings/settings.module';
import { PlaybookController } from './playbook.controller';
import { PlaybookService } from './playbook.service';
import { RetroController } from './retro.controller';
import { RetroService } from './retro.service';

@Module({
  imports: [PostsModule, AnalyticsModule, RunnerModule, RunsModule, SettingsModule],
  providers: [PlaybookService, RetroService],
  controllers: [PlaybookController, RetroController],
  exports: [PlaybookService, RetroService],
})
export class PlaybookModule {}
