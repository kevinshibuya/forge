import { Module } from '@nestjs/common';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { PostsModule } from '../posts/posts.module';
import { RunnerModule } from '../runner/runner.module';
import { SettingsModule } from '../settings/settings.module';
import { IdeasController } from './ideas.controller';
import { IdeasService } from './ideas.service';

@Module({
  imports: [EmbeddingsModule, PostsModule, RunnerModule, SettingsModule],
  providers: [IdeasService],
  controllers: [IdeasController],
  exports: [IdeasService],
})
export class IdeasModule {}
