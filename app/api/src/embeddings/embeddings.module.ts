import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { EMBEDDING_PROVIDER } from './provider.interface';
import { OpenAiEmbeddingProvider } from './openai.provider';
import { EmbeddingsService } from './embeddings.service';
import { RetryPoller } from './retry.poller';

@Module({
  imports: [SettingsModule],
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      inject: [SettingsService],
      useFactory: async (settings: SettingsService) =>
        new OpenAiEmbeddingProvider((await settings.get()).embeddingModel),
    },
    EmbeddingsService,
    RetryPoller,
  ],
  exports: [EmbeddingsService, EMBEDDING_PROVIDER],
})
export class EmbeddingsModule {}
