import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eq, lt } from 'drizzle-orm';
import { DB, ForgeDb } from '../db/client';
import { embeddingJobs } from '../db/schema';
import { EmbeddingsService, EmbeddingSourceType } from './embeddings.service';

const MAX_ATTEMPTS = 5;

@Injectable()
export class RetryPoller implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RetryPoller.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DB) private readonly db: ForgeDb,
    private readonly embeddings: EmbeddingsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void this.tick(); }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void { clearInterval(this.timer); }

  async tick(): Promise<number> {
    const jobs = await this.db.select().from(embeddingJobs)
      .where(lt(embeddingJobs.attempts, MAX_ATTEMPTS))
      .orderBy(embeddingJobs.createdAt)
      .limit(10);
    let processed = 0;
    for (const job of jobs) {
      try {
        await this.embeddings.writeChunks(
          job.sourceType as EmbeddingSourceType, job.sourceId, job.chunks as string[],
        );
        await this.db.delete(embeddingJobs).where(eq(embeddingJobs.id, job.id));
        processed += 1;
      } catch (err) {
        await this.db.update(embeddingJobs)
          .set({ attempts: job.attempts + 1, lastError: String(err) })
          .where(eq(embeddingJobs.id, job.id));
        this.log.warn(`retry ${job.id} failed (attempt ${job.attempts + 1})`);
      }
    }
    return processed;
  }
}
