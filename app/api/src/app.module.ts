import { Controller, Get, Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { SettingsModule } from './settings/settings.module';
import { RunnerModule } from './runner/runner.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { PostsModule } from './posts/posts.module';
import { IdeasModule } from './ideas/ideas.module';
import { PlaybookModule } from './playbook/playbook.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { DraftingModule } from './drafting/drafting.module';
import { PlanningModule } from './planning/planning.module';
import { ImagesModule } from './images/images.module';
import { InputsModule } from './inputs/inputs.module';
import { ModelRegistryModule } from './registry/model-registry.module';
import { LedgerModule } from './ledger/ledger.module';

@Controller()
class HealthController {
  @Get('health')
  health() { return { ok: true }; }
}

@Module({
  imports: [DbModule, SettingsModule, RunnerModule, EmbeddingsModule, RetrievalModule, PostsModule, IdeasModule, PlaybookModule, AnalyticsModule, DraftingModule, PlanningModule, ImagesModule, InputsModule, ModelRegistryModule, LedgerModule],
  controllers: [HealthController],
})
export class AppModule {}
