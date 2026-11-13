import { Inject, Injectable } from '@nestjs/common';
import { and, cosineDistance, desc, eq, inArray, not, sql } from 'drizzle-orm';
import { DB, ForgeDb } from '../db/client';
import { embeddings } from '../db/schema';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../embeddings/provider.interface';
import { SettingsService } from '../settings/settings.service';

export interface Exemplar {
  sourceType: 'post' | 'idea' | 'inspiration' | 'retro_note';
  sourceId: number;
  chunkText: string;
  similarity: number;
}

@Injectable()
export class RetrievalService {
  constructor(
    @Inject(DB) private readonly db: ForgeDb,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
    private readonly settings: SettingsService,
  ) {}

  async similar(
    queryText: string,
    opts: {
      types?: Exemplar['sourceType'][];
      k?: number;
      exclude?: { sourceType: Exemplar['sourceType']; sourceId: number };
    } = {},
  ): Promise<Exemplar[]> {
    const k = opts.k ?? (await this.settings.get()).retrievalK;
    const [queryVec] = await this.provider.embed([queryText]);
    const similarity = sql<number>`1 - (${cosineDistance(embeddings.embedding, queryVec!)})`;

    const conds = [];
    if (opts.types && opts.types.length > 0) conds.push(inArray(embeddings.sourceType, opts.types));
    if (opts.exclude) {
      conds.push(not(and(
        eq(embeddings.sourceType, opts.exclude.sourceType),
        eq(embeddings.sourceId, opts.exclude.sourceId),
      )!));
    }

    const rows = await this.db
      .select({
        sourceType: embeddings.sourceType,
        sourceId: embeddings.sourceId,
        chunkText: embeddings.chunkText,
        similarity,
      })
      .from(embeddings)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(similarity))
      .limit(k);

    return rows;
  }
}
