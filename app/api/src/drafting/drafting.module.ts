import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IdeasModule } from '../ideas/ideas.module';
import { InputsModule } from '../inputs/inputs.module';
import { PlaybookModule } from '../playbook/playbook.module';
import { PostsModule } from '../posts/posts.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { RunnerModule } from '../runner/runner.module';
import { RunsModule } from '../runs/runs.module';
import { SettingsModule } from '../settings/settings.module';
import { DraftingController } from './drafting.controller';
import { DraftingService } from './drafting.service';

@Module({
  imports: [PostsModule, IdeasModule, PlaybookModule, AnalyticsModule, RetrievalModule, RunnerModule, RunsModule, SettingsModule, InputsModule],
  providers: [DraftingService],
  controllers: [DraftingController],
  exports: [DraftingService],
})
export class DraftingModule {}
