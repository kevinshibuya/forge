import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EmbeddingsService } from '../src/embeddings/embeddings.service';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { RetrievalModule } from '../src/retrieval/retrieval.module';
import { RetrievalService } from '../src/retrieval/retrieval.service';
import { embeddings } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('RetrievalService', () => {
  let retrieval: RetrievalService;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, RetrievalModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .compile();
    retrieval = mod.get(RetrievalService);
    const embSvc = mod.get(EmbeddingsService);

    await createDb(url).delete(embeddings);
    await embSvc.upsertFor('post', 1, 'a post about multi-agent orchestration ladders');
    await embSvc.upsertFor('post', 2, 'a post about sourdough baking on weekends');
    await embSvc.upsertFor('inspiration', 3, 'multi-agent orchestration with cheap models');
  });

  it('returns the identical text as the closest match', async () => {
    const hits = await retrieval.similar('a post about multi-agent orchestration ladders');
    expect(hits[0]!.sourceId).toBe(1);
    expect(hits[0]!.similarity).toBeGreaterThan(0.99);
  });

  it('filters by source type and respects k', async () => {
    const hits = await retrieval.similar('anything', { types: ['inspiration'], k: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sourceType).toBe('inspiration');
  });

  it('treats an empty types array as no filter', async () => {
    const filtered = await retrieval.similar('anything', { types: [], k: 10 });
    const unfiltered = await retrieval.similar('anything', { k: 10 });
    expect(filtered).toHaveLength(unfiltered.length);
    expect(unfiltered.length).toBeGreaterThan(0);
  });

  it('exclude drops the post being drafted from its own exemplars', async () => {
    const hits = await retrieval.similar('a post about multi-agent orchestration ladders', {
      exclude: { sourceType: 'post', sourceId: 1 },
    });
    expect(hits.some((h) => h.sourceType === 'post' && h.sourceId === 1)).toBe(false);
    expect(hits.length).toBeGreaterThan(0);
  });
});
