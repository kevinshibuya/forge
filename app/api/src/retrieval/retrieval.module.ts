import { Module } from '@nestjs/common';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { SettingsModule } from '../settings/settings.module';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [EmbeddingsModule, SettingsModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
