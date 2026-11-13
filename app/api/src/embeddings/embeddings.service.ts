import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, ForgeDb } from '../db/client';
import { embeddingJobs, embeddings } from '../db/schema';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './provider.interface';

export type EmbeddingSourceType = 'post' | 'idea' | 'inspiration' | 'retro_note';

/** The drizzle transaction handle, the same alias analytics.service.ts:24 declares privately. */
export type Tx = Parameters<Parameters<ForgeDb['transaction']>[0]>[0];

export function chunkText(text: string, maxChars = 4000): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) chunks.push(text.slice(i, i + maxChars));
  return chunks;
}

@Injectable()
export class EmbeddingsService {
  private readonly log = new Logger(EmbeddingsService.name);

  constructor(
    @Inject(DB) private readonly db: ForgeDb,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
  ) {}

  async upsertFor(sourceType: EmbeddingSourceType, sourceId: number, text: string): Promise<void> {
    const chunks = chunkText(text);
    try {
      await this.writeChunks(sourceType, sourceId, chunks);
    } catch (err) {
      this.log.warn(`embedding failed for ${sourceType}:${sourceId}, queueing retry: ${String(err)}`);
      await this.db.insert(embeddingJobs).values({ sourceType, sourceId, chunks });
    }
  }

  /**
   * Every chunk and every pending retry job for one source, on the handle given. A caller deleting
   * the source row passes its own `tx` so the purge commits or rolls back with the delete: a
   * dangling post vector puts a deleted post's text into a prompt, and a crash between a commit and
   * a later purge would leave exactly that.
   */
  async removeFor(sourceType: EmbeddingSourceType, sourceId: number, on: Tx | ForgeDb = this.db): Promise<void> {
    await on.delete(embeddings).where(
      and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)),
    );
    await on.delete(embeddingJobs).where(
      and(eq(embeddingJobs.sourceType, sourceType), eq(embeddingJobs.sourceId, sourceId)),
    );
  }

  async writeChunks(sourceType: EmbeddingSourceType, sourceId: number, chunks: string[]): Promise<void> {
    const vectors = await this.provider.embed(chunks);
    await this.db.transaction(async (tx) => {
      await tx.delete(embeddings).where(
        and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)),
      );
      await tx.insert(embeddings).values(chunks.map((chunkText, i) => ({
        sourceType, sourceId, chunkIndex: i, chunkText,
        embedding: vectors[i]!, model: this.provider.model,
      })));
    });
  }
}
