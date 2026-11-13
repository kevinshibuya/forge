import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { readFile, unlink } from 'node:fs/promises';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { AssetLane, AssetOrigin } from '@forge/shared';
import { DB, ForgeDb } from '../db/client';
import { assets, posts, runSteps } from '../db/schema';
import { type RunStepDto, toRunStepDto } from '../runs/run-step.dto';
import { toStepRow } from '../runs/runs.service';
import { bgPathFor, readPngSize, resolveAssetFile } from './asset-store';

export type AssetRow = typeof assets.$inferSelect;

export { type RunStepDto };

export interface CreateAsset {
  postId: number; lane: AssetLane; htmlSource?: string; generationPrompt?: string;
  pngPath: string; width: number; height: number; candidateGroupId: string;
  /** lineage (spec §1b): the run that produced this asset, plus what it was derived from. */
  runId?: number; sourceAssetId?: number; origin?: AssetOrigin;
}

export type AssetSort = 'newest' | 'oldest';

export interface ListPageOptions {
  limit?: number; offset?: number; sort?: AssetSort; origin?: AssetOrigin;
}

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

export interface AssetBreakdownDto {
  assetId: number; generationPrompt: string | null; runId: number | null; steps: RunStepDto[];
}

@Injectable()
export class ImagesService {
  private readonly log = new Logger(ImagesService.name);
  constructor(@Inject(DB) private readonly db: ForgeDb) {}

  listForPost(postId: number): Promise<AssetRow[]> {
    return this.db.select().from(assets).where(eq(assets.postId, postId)).orderBy(asc(assets.id));
  }

  /**
   * One page of a post's assets plus the total under the SAME filter, so the UI can page without
   * loading every candidate. `total` is counted separately (not derived from `items.length`) —
   * that is the only way a paged client knows how many pages exist.
   * Sort ties break on id so a page boundary can never repeat or skip a row when two candidates
   * from the same batch share a created_at.
   */
  async listPage(postId: number, opts: ListPageOptions = {}): Promise<{ items: AssetRow[]; total: number }> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);
    const where = opts.origin
      ? and(eq(assets.postId, postId), eq(assets.origin, opts.origin))
      : eq(assets.postId, postId);
    const order = opts.sort === 'oldest'
      ? [asc(assets.createdAt), asc(assets.id)]
      : [desc(assets.createdAt), desc(assets.id)];
    const [items, [totalRow]] = await Promise.all([
      this.db.select().from(assets).where(where).orderBy(...order).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(assets).where(where),
    ]);
    return { items, total: totalRow?.n ?? 0 };
  }

  /**
   * The post's selected winner, looked up independently of any page window. The hero has to keep
   * showing when the selection sits on page 3 or is filtered out — deriving it from the current
   * page would make it blink out as the user pages around.
   */
  async selectedFor(postId: number): Promise<AssetRow | null> {
    const [row] = await this.db.select().from(assets)
      .where(and(eq(assets.postId, postId), eq(assets.isSelected, true))).limit(1);
    return row ?? null;
  }

  /**
   * Provenance for one asset: the prompt it was generated from plus every engine sub-call of its
   * run, in seq order. Assets predating the `run_id` FK simply have no run — they return empty
   * steps rather than a guessed-at match ("not recorded", never fabricated).
   */
  async breakdown(assetId: number): Promise<AssetBreakdownDto> {
    const asset = await this.get(assetId);
    const steps = asset.runId
      ? await this.db.select().from(runSteps).where(eq(runSteps.runId, asset.runId)).orderBy(asc(runSteps.seq))
      : [];
    return {
      assetId: asset.id,
      generationPrompt: asset.generationPrompt,
      runId: asset.runId,
      steps: steps.map((r) => toRunStepDto(toStepRow(r))),
    };
  }

  async get(id: number): Promise<AssetRow> {
    const [row] = await this.db.select().from(assets).where(eq(assets.id, id));
    if (!row) throw new NotFoundException(`asset ${id} not found`);
    return row;
  }

  async create(input: CreateAsset): Promise<AssetRow> {
    const [row] = await this.db.insert(assets).values(input).returning();
    return row!;
  }

  /** Insert every candidate in ONE statement so a partially-written grid never lands (atomic ingest). */
  async createMany(inputs: CreateAsset[]): Promise<AssetRow[]> {
    if (inputs.length === 0) return [];
    return this.db.insert(assets).values(inputs).returning();
  }

  async select(postId: number, assetId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Serialize concurrent selects on the same post so exactly one row stays selected.
      // No DB unique index on is_selected — this enforces the invariant in-app (no migration).
      await tx.execute(sql`select pg_advisory_xact_lock(${postId})`);
      const [a] = await tx.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.postId, postId)));
      if (!a) throw new NotFoundException(`asset ${assetId} not found on post ${postId}`);
      await tx.update(assets).set({ isSelected: false }).where(eq(assets.postId, postId));
      await tx.update(assets).set({ isSelected: true }).where(eq(assets.id, assetId));
    });
  }

  // Scoped by (assetId, postId): a model-supplied assetId can never touch another post's row.
  async setReview(assetId: number, postId: number, score: number, notes: string): Promise<void> {
    await this.db.update(assets).set({ reviewScore: score, reviewNotes: notes })
      .where(and(eq(assets.id, assetId), eq(assets.postId, postId)));
  }

  /** Apply an entire review grid atomically: either every candidate's score lands, or none does.
   *  Each write is scoped by (assetId, postId) so a model-supplied id can never touch another post. */
  async setReviews(postId: number, scores: { assetId: number; score: number; notes: string }[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const s of scores) {
        await tx.update(assets).set({ reviewScore: s.score, reviewNotes: s.notes })
          .where(and(eq(assets.id, s.assetId), eq(assets.postId, postId)));
      }
    });
  }

  async remove(postId: number, assetId: number): Promise<void> {
    const [row] = await this.db.delete(assets)
      .where(and(eq(assets.id, assetId), eq(assets.postId, postId))).returning();
    if (!row) throw new NotFoundException(`asset ${assetId} not found on post ${postId}`);
    if (row.pngPath) {
      try { await unlink(resolveAssetFile(row.pngPath)); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn(`unlink ${row.pngPath} failed: ${String(err)}`); }
    }
  }

  /** Resolve the post's reference background. null = no reference set; throws when set-but-broken (fail-loud). */
  async referenceBgFor(postId: number): Promise<string | null> {
    const [post] = await this.db.select({ ref: posts.referenceAssetId }).from(posts).where(eq(posts.id, postId));
    if (!post?.ref) return null;
    const asset = await this.get(post.ref);
    const bg = asset.pngPath ? bgPathFor(asset.pngPath) : null;
    if (!bg || !(await readPngSize(bg))) {
      throw new Error(`reference asset ${post.ref}: bg.png missing or unreadable at ${bg ?? '<no png_path>'}`);
    }
    return bg;
  }

  async pngPathFor(assetId: number): Promise<string> {
    const row = await this.get(assetId);
    if (!row.pngPath) throw new NotFoundException(`asset ${assetId} has no rendered png`);
    return resolveAssetFile(row.pngPath);
  }

  async dataUri(assetId: number): Promise<string> {
    const buf = await readFile(await this.pngPathFor(assetId));
    return `data:image/png;base64,${buf.toString('base64')}`;
  }
}
