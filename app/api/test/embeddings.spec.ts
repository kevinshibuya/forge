import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb, ForgeDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EmbeddingsService } from '../src/embeddings/embeddings.service';
import { RetryPoller } from '../src/embeddings/retry.poller';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { chunkText } from '../src/embeddings/embeddings.service';
import { embeddingJobs, embeddings } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

class FlakyProvider extends FakeEmbeddingProvider {
  calls = 0;
  override async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    if (this.calls === 1) throw new Error('openai 500');
    return super.embed(texts);
  }
}

describe('chunkText', () => {
  it('splits long text and keeps short text whole', () => {
    expect(chunkText('short')).toEqual(['short']);
    const chunks = chunkText('x'.repeat(9000), 4000);
    expect(chunks).toHaveLength(3);
  });
});

describe('EmbeddingsService', () => {
  let svc: EmbeddingsService;
  let poller: RetryPoller;
  let db: ForgeDb;
  const flaky = new FlakyProvider();

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule, EmbeddingsModule] })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(flaky)
      .compile();
    svc = mod.get(EmbeddingsService);
    poller = mod.get(RetryPoller);
    db = createDb(url);
    await db.delete(embeddings);
    await db.delete(embeddingJobs);
  });

  it('provider failure enqueues a retry job; poller drains it', async () => {
    await svc.upsertFor('post', 42, 'my first post about agent ladders');
    expect(await db.$count(embeddingJobs)).toBe(1);
    expect(await db.$count(embeddings)).toBe(0);

    const processed = await poller.tick();
    expect(processed).toBe(1);
    expect(await db.$count(embeddingJobs)).toBe(0);
    const rows = await db.select().from(embeddings);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe(flaky.model);
    expect(rows[0]!.embedding).toHaveLength(1536);
  });

  it('upsert replaces existing chunks', async () => {
    await svc.upsertFor('post', 42, 'rewritten body');
    const rows = await db.select().from(embeddings);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chunkText).toBe('rewritten body');
  });

  it('parks jobs at the attempts cap without retrying them', async () => {
    await db.delete(embeddingJobs);
    const [parked] = await db.insert(embeddingJobs)
      .values({ sourceType: 'post', sourceId: 99, chunks: ['poison'], attempts: 5 })
      .returning();

    const processed = await poller.tick();
    expect(processed).toBe(0);

    const rows = await db.select().from(embeddingJobs).where(eq(embeddingJobs.id, parked!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(5);

    await db.delete(embeddingJobs);
  });

  // The two cases below leave survivors behind, so they stay LAST: the cases above assert on the
  // whole table unfiltered.
  const chunksOf = (sourceType: 'post' | 'idea', sourceId: number) => db.select().from(embeddings)
    .where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)));
  const jobsOf = (sourceType: 'post' | 'idea', sourceId: number) => db.select().from(embeddingJobs)
    .where(and(eq(embeddingJobs.sourceType, sourceType), eq(embeddingJobs.sourceId, sourceId)));

  it("removeFor purges one source's chunks and retry jobs, and nothing else", async () => {
    await svc.upsertFor('post', 43, 'text');
    await svc.upsertFor('idea', 43, 'text');
    await svc.upsertFor('post', 44, 'text');
    await db.insert(embeddingJobs).values({ sourceType: 'post', sourceId: 43, chunks: ['text'] });
    expect(await chunksOf('post', 43)).toHaveLength(1);
    expect(await jobsOf('post', 43)).toHaveLength(1);

    await db.transaction((tx) => svc.removeFor('post', 43, tx));

    expect(await chunksOf('post', 43)).toHaveLength(0);
    expect(await jobsOf('post', 43)).toHaveLength(0);
    expect(await chunksOf('idea', 43)).toHaveLength(1);
    expect(await chunksOf('post', 44)).toHaveLength(1);
  });

  it("removeFor rolls back with the caller's transaction", async () => {
    await svc.upsertFor('post', 45, 'text');
    await db.insert(embeddingJobs).values({ sourceType: 'post', sourceId: 45, chunks: ['text'] });

    await expect(db.transaction(async (tx) => {
      await svc.removeFor('post', 45, tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    expect(await chunksOf('post', 45)).toHaveLength(1);
    expect(await jobsOf('post', 45)).toHaveLength(1);
  });
});
