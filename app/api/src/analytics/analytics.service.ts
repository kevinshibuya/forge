import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { engagementRate, type Demographics, type DemoRow, type RunKind } from '@forge/shared';
import { DB, ForgeDb } from '../db/client';
import {
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric, posts as postsTable,
  runs as runsTable, sourceFiles,
} from '../db/schema';
import { postLabel, PostsService, type PostRow } from '../posts/posts.service';
import type { AudienceRow, ParsedAggregate, ParsedSinglePost } from './export-types';
import { parseExport } from './export-parser';
import { extractPostUrn, type PostUrn } from './post-identity';
import { XlsxShapeError, ZONE } from './xlsx-parser';

/** A drizzle transaction handle, named without reaching for `any`. */
type Tx = Parameters<Parameters<ForgeDb['transaction']>[0]>[0];

type SourceFileRow = typeof sourceFiles.$inferSelect;
type AudienceFactRow = typeof factAudienceSegment.$inferSelect;

export interface ImportResult {
  sourceFileId: number;
  kind: 'aggregate' | 'single_post';
  linkedPostId: number | null;
  factCounts: { profile: number; lifetime: number; window: number; audience: number };
  warnings: string[];
  alreadyImported?: true;
}

/** `POST /analytics/link` — the hand-attach of an imported urn to an app post. */
export interface LinkResult {
  postUrn: string;
  postId: number;
  /** Non-fatal notes, same vocabulary as an import's: a status that blocked the measured move. */
  warnings: string[];
}

/**
 * The pre-canonical per-post snapshot shape, now synthesized from the canonical tables.
 * Kept as an explicit interface because `drafting.service` is written against these exact
 * fields. The pivot behind it STAYS: `forPost`/`latestByPost`/`countMeasuredSince` feed
 * drafting, retro and planning, none of which the analytics rebuild touches — only the
 * HTTP payload of `GET /analytics/posts/:postId` moved to `postDetail()` (spec §6).
 */
export interface SnapshotRow {
  /** The newest source file that contributed to this day. */
  id: number;
  postId: number;
  capturedAt: Date;
  createdAt: Date;
  rawFilePath: string | null;
  impressions: number;
  membersReached: number | null;
  reactions: number;
  comments: number;
  shares: number;
  saves: number;
  followsGained: number | null;
  profileViews: number | null;
  demographics: Demographics | null;
}

const UPLOADS_DIR = join('uploads', 'analytics');

/**
 * The Overview endpoint's day boundary — pinned to the ingestion zone rather than the
 * settings zone, because `fact_profile_metric` dates are zone-fixed at parse time (spec §5).
 */
const OVERVIEW_ZONE = 'America/Sao_Paulo';

/** The per-day profile metrics; `followers_total` is a sparse snapshot, not a daily row. */
const DAILY_PROFILE_METRICS = ['impressions', 'engagements', 'followers_new'] as const;

export interface OverviewWindowTotals {
  /** ISO dates, inclusive on both ends. */
  start: string;
  end: string;
  impressions: number;
  engagements: number;
  followersNew: number;
  postsPublished: number;
  daysWithData: number;
}

export interface OverviewDto {
  window: 7 | 28 | 90;
  current: OverviewWindowTotals;
  previous: OverviewWindowTotals;
  /** ISO weekday buckets, 1=mon … 7=sun — always all 7, zero-filled. */
  weekday: { weekday: number; impressions: number; engagements: number }[];
  followersTotal: { value: number; asOf: string } | null;
}

// ---------------------------------------------------------------------------
// Board (the Analytics page's one read-only aggregate)
// ---------------------------------------------------------------------------

export type BoardRange = '7' | '28' | '90' | 'all';
const BOARD_RANGES: readonly BoardRange[] = ['7', '28', '90', 'all'];

/** One day that actually carries imported daily rows. Missing days are ABSENT, never zero-filled. */
export interface BoardSeriesPoint {
  date: string;
  impressions: number;
  engagements: number;
  followersNew: number;
}

export interface BoardTotals {
  impressions: number;
  engagements: number;
  followersNew: number;
  postsPublished: number;
}

/**
 * One deduped `dim_post`. `grain: 'window'` means the row is seeded only by the aggregate
 * top-posts sheet: its impressions come from `fact_window_metric` and every derived stat is
 * null, because stats are never derived across grains (spec §1).
 */
export interface BoardPostRow {
  postUrn: string;
  postId: number | null;
  title: string | null;
  linkedinUrl: string;
  publishedAt: string | null;
  grain: 'lifetime' | 'window';
  impressions: number;
  engagements: number | null;
  er: number | null;
  followsGained: number | null;
}

export interface BoardAudienceSegment { segment: string; value: number; unit: string }
export interface BoardAudienceDimension { dimension: string; segments: BoardAudienceSegment[] }
export interface BoardAudience { asOf: string; dimensions: BoardAudienceDimension[] }

export interface BoardSpendByKind { kind: RunKind; total: number }
export interface BoardSpendByPost { postId: number; title: string; cost: number; impressions: number }

/** Every figure is the cost recorded on the runs at call time, from the registry row's list prices. */
export interface BoardSpend {
  total: number;
  runs: number;
  perPublishedPost: number | null;
  byKind: BoardSpendByKind[];
  byPost: BoardSpendByPost[];
}

export interface BoardDto {
  range: BoardRange;
  /** ISO dates, inclusive on both ends. */
  start: string;
  end: string;
  series: BoardSeriesPoint[];
  totals: BoardTotals;
  followersTotal: { value: number; asOf: string } | null;
  posts: BoardPostRow[];
  audience: BoardAudience | null;
  spend: BoardSpend;
}

// ---------------------------------------------------------------------------
// Post detail (the `/analytics/:postId` page's one read-only aggregate)
// ---------------------------------------------------------------------------

export interface PostDetailIdentity {
  id: number;
  title: string;
  tier: PostRow['tier'];
  publishedAt: string | null;
  linkedinUrl: string | null;
}

/** The latest value a metric reached, and the capture day it was read on. */
export interface PostDetailMetric { metric: string; value: number; asOf: string }

/** One capture day carrying an impressions row. Capture days are sparse and NOT adjacent. */
export interface PostDetailSeriesPoint { asOf: string; impressions: number }

export interface PostDetailRun {
  runId: number;
  kind: RunKind;
  engine: string;
  model: string;
  /** Recorded at call time from the registry row; null when the call reported nothing to price. */
  costUsd: number | null;
}

/** `total` is null when NO run of this post is priceable; unpriceable items never count as 0. */
export interface PostDetailRuns { total: number | null; items: PostDetailRun[] }

export interface PostDetailDto {
  post: PostDetailIdentity;
  /** Latest value PER METRIC across every urn form of the post; `[]` when no lifetime facts. */
  latest: PostDetailMetric[];
  /** Ascending by capture day. The web charts it only at length >= 2 — one capture is no series. */
  series: PostDetailSeriesPoint[];
  /** THIS post's demographics at its newest capture day, same shape as the board's. */
  audience: BoardAudience | null;
  runs: PostDetailRuns;
}

/** Narrows a raw query string to the range set — the controller's 400 without a cast. */
export function isBoardRange(value: string): value is BoardRange {
  return (BOARD_RANGES as readonly string[]).includes(value);
}

/** Canonical dimension -> the legacy `Demographics` key the compat layer still speaks. */
const DEMOGRAPHIC_KEYS: Record<string, keyof Demographics> = {
  job_title: 'jobTitles',
  location: 'locations',
  seniority: 'seniority',
  company: 'companies',
  industry: 'industries',
  company_size: 'companySizes',
};

/** Lifetime metric -> the legacy column it feeds. `reposts` is exported as `shares`. */
const REQUIRED_COMPAT_METRICS = ['impressions', 'reactions', 'comments', 'reposts', 'saves'] as const;

function emptyDemographics(): Demographics {
  return { jobTitles: [], locations: [], seniority: [], companies: [], industries: [], companySizes: [] };
}

/** A `YYYY-MM-DD` calendar date resolved in the account's zone — never `new Date('YYYY-MM-DD')`. */
function dateOnlyToInstant(isoDate: string): Date | null {
  const dt = DateTime.fromISO(isoDate, { zone: ZONE });
  return dt.isValid ? dt.toJSDate() : null;
}

function toZonedDate(at: Date): string {
  return DateTime.fromJSDate(at).setZone(ZONE).toFormat('yyyy-MM-dd');
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DB) private readonly db: ForgeDb,
    private readonly posts: PostsService,
  ) {}

  // -------------------------------------------------------------------------
  // Ingestion
  // -------------------------------------------------------------------------

  /**
   * Ingests either LinkedIn export type. The file hash is the idempotency key: an
   * already-seen file short-circuits unless `force` or `postId` asks for the full
   * parse/upsert/link path again (the reparse-after-parser-fix and link-healing paths).
   */
  async importXlsx(
    file: { buffer: Buffer; originalname: string },
    opts: { postId?: number; force?: boolean; capturedAt?: Date } = {},
  ): Promise<ImportResult> {
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const reingest = opts.force === true || opts.postId !== undefined;
    const [seen] = await this.db.select().from(sourceFiles).where(eq(sourceFiles.sha256, sha256));
    if (seen && !reingest) {
      const seenWarnings: string[] = [];
      return {
        sourceFileId: seen.id,
        kind: seen.kind,
        linkedPostId: await this.healLink(seen.id, seenWarnings),
        factCounts: { profile: 0, lifetime: 0, window: 0, audience: 0 },
        warnings: seenWarnings,
        alreadyImported: true,
      };
    }

    const parsed = await parseExport(file.buffer);
    const warnings: string[] = [];
    // A reparse keeps the file's ORIGINAL capture instant. `imported_at` dates every fact
    // this file owns (the compat pivot reads `capturedAt` from it, and `as_of_date` is
    // derived from it), so defaulting to "now" on a re-upload would silently restate an
    // old measurement as today's — and, since the facts land on a fresh `as_of_date` PK,
    // leave the original day orphaned beside it.
    const capturedAt = opts.capturedAt ?? seen?.importedAt ?? new Date();

    // Resolve the app post BEFORE any write: a bad `?postId=` must not archive a file
    // or leave a source_files row behind.
    let urn: PostUrn | null = null;
    let match: PostRow | null = null;
    if (parsed.kind === 'single_post') {
      urn = extractPostUrn(parsed.postUrl);
      if (!urn) {
        throw new XlsxShapeError(`"URL da publicação" carries no post urn: ${parsed.postUrl}`);
      }
      match = opts.postId !== undefined
        ? await this.posts.get(opts.postId) // NotFound propagates, as it always has
        : await this.matchPost(parsed.postUrl, urn);
      if (!match) {
        warnings.push(
          `no app post matches ${parsed.postUrl} — the export was ingested unlinked; `
          + 'publish the post with this url, then upload this file again to link it',
        );
      }
    } else if (opts.postId !== undefined) {
      warnings.push(
        `?postId=${opts.postId} was ignored: an aggregate export covers the whole account, `
        + 'so its posts are linked by url, not by hand',
      );
    }

    // Archive first: an orphaned raw file after a failed transaction is harmless and
    // self-heals on retry, whereas a committed row without its file would not.
    const rawPath = join(UPLOADS_DIR, `${sha256}.xlsx`);
    await mkdir(join(process.cwd(), UPLOADS_DIR), { recursive: true });
    await writeFile(join(process.cwd(), rawPath), file.buffer);

    const counts = { profile: 0, lifetime: 0, window: 0, audience: 0 };
    const sourceFileId = await this.db.transaction(async (tx) => {
      const window = parsed.kind === 'aggregate' ? parsed.window : null;
      const [sf] = await tx.insert(sourceFiles).values({
        sha256,
        kind: parsed.kind,
        originalName: file.originalname,
        windowStart: window?.start ?? null,
        windowEnd: window?.end ?? null,
        importedAt: capturedAt,
        rawPath,
      }).onConflictDoUpdate({
        target: sourceFiles.sha256,
        // `created_at` is deliberately untouched: it is the row-insert instant that
        // retro eligibility compares against.
        set: {
          kind: parsed.kind,
          originalName: file.originalname,
          windowStart: window?.start ?? null,
          windowEnd: window?.end ?? null,
          importedAt: capturedAt,
          rawPath,
        },
      }).returning();
      const fileId = sf!.id;

      if (opts.force === true) await this.purgeFacts(tx, fileId);

      if (parsed.kind === 'single_post') {
        Object.assign(counts, await this.ingestSinglePost(tx, parsed, {
          urn: urn!, fileId, postId: match?.id ?? null, asOfDate: toZonedDate(capturedAt),
        }));
      } else {
        Object.assign(counts, await this.ingestAggregate(tx, parsed, { fileId, warnings }));
      }
      return fileId;
    });

    if (match) await this.applyMeasured(match, warnings);

    return {
      sourceFileId,
      kind: parsed.kind,
      linkedPostId: match?.id ?? null,
      factCounts: counts,
      warnings,
    };
  }

  /** Exact url first (today's proven path), then urn comparison — never the reverse. */
  private async matchPost(url: string, urn: PostUrn): Promise<PostRow | null> {
    const exact = await this.posts.findByUrl(url);
    if (exact) return exact;
    const candidates = await this.db.select().from(postsTable)
      .where(isNotNull(postsTable.linkedinUrl))
      .orderBy(postsTable.id);
    // newest-first, mirroring findByUrl's determinism rule
    for (const post of [...candidates].reverse()) {
      if (extractPostUrn(post.linkedinUrl ?? '')?.urn === urn.urn) return post;
    }
    return null;
  }

  /**
   * `markMeasured` is for published posts only. A post already measured no-ops as it
   * always has; anything else stays linked, keeps its status, and earns a warning —
   * ingestion never fails over an app-side state.
   */
  private async applyMeasured(post: PostRow, warnings: string[]): Promise<void> {
    if (post.status === 'published') {
      await this.posts.markMeasured(post.id);
      return;
    }
    if (post.status === 'measured') return;
    warnings.push(`post ${post.id} is '${post.status}', not 'published' — linked without marking it measured`);
  }

  /**
   * The already-imported path is a healing path, not a dead end. The unlinked warning tells
   * the user to publish the post and re-upload — but re-uploading the same bytes short-circuits
   * on the sha256, so without this the advertised remedy would never actually link anything.
   * Re-matching off `dim_post` avoids reparsing the workbook. It also retries the measured
   * transition, which runs outside the ingest transaction and can be lost to a transient failure.
   */
  private async healLink(sourceFileId: number, warnings: string[]): Promise<number | null> {
    const linked = await this.linkedPostForFile(sourceFileId);
    if (linked !== null) {
      await this.applyMeasured(await this.posts.get(linked), warnings);
      return linked;
    }
    const orphans = await this.db
      .selectDistinct({ urn: dimPost.postUrn, url: dimPost.linkedinUrl })
      .from(dimPost)
      .innerJoin(factPostLifetime, eq(factPostLifetime.postUrn, dimPost.postUrn))
      .where(and(eq(factPostLifetime.sourceFileId, sourceFileId), isNull(dimPost.postId)));
    for (const orphan of orphans) {
      const urn = extractPostUrn(orphan.url);
      const match = urn === null ? null : await this.matchPost(orphan.url, urn);
      if (match === null) continue;
      await this.db.update(dimPost).set({ postId: match.id })
        .where(eq(dimPost.postUrn, orphan.urn));
      await this.applyMeasured(match, warnings);
      return match.id;
    }
    return null;
  }

  private async linkedPostForFile(sourceFileId: number): Promise<number | null> {
    const [row] = await this.db.select({ postId: dimPost.postId })
      .from(factPostLifetime)
      .innerJoin(dimPost, eq(dimPost.postUrn, factPostLifetime.postUrn))
      .where(eq(factPostLifetime.sourceFileId, sourceFileId))
      .limit(1);
    return row?.postId ?? null;
  }

  /** `?force` drops everything this file previously wrote, so a fixed parser leaves no orphans. */
  private async purgeFacts(tx: Tx, sourceFileId: number): Promise<void> {
    await tx.delete(factPostLifetime).where(eq(factPostLifetime.sourceFileId, sourceFileId));
    await tx.delete(factWindowMetric).where(eq(factWindowMetric.sourceFileId, sourceFileId));
    await tx.delete(factAudienceSegment).where(eq(factAudienceSegment.sourceFileId, sourceFileId));
    await tx.delete(factProfileMetric).where(eq(factProfileMetric.sourceFileId, sourceFileId));
  }

  /**
   * Dedupe order per the spec: exact url equality wins over urn equality, because the
   * same post carries the same slug url across export types while the numeric id
   * differs between urn types. Returns the canonical `post_urn` of the row in use.
   */
  private async upsertDimPost(tx: Tx, input: {
    url: string;
    urn: PostUrn;
    /** `precise` marks a full timestamp; a date-only value never overwrites an existing one. */
    publishedAt: { at: Date; precise: boolean } | null;
    fileId: number;
    postId: number | null;
  }): Promise<string> {
    const [byUrl] = await tx.select().from(dimPost).where(eq(dimPost.linkedinUrl, input.url)).limit(1);
    const existing = byUrl
      ?? (await tx.select().from(dimPost).where(eq(dimPost.postUrn, input.urn.urn)).limit(1))[0];

    const typed = {
      activity: input.urn.type === 'activity' ? input.urn.urn : undefined,
      share: input.urn.type === 'share' ? input.urn.urn : undefined,
      ugcPost: input.urn.type === 'ugcPost' ? input.urn.urn : undefined,
    };

    if (!existing) {
      await tx.insert(dimPost).values({
        postUrn: input.urn.urn,
        activityUrn: typed.activity ?? null,
        shareUrn: typed.share ?? null,
        ugcUrn: typed.ugcPost ?? null,
        postId: input.postId,
        linkedinUrl: input.url,
        publishedAt: input.publishedAt?.at ?? null,
        firstSeenSourceFileId: input.fileId,
      });
      return input.urn.urn;
    }

    const patch: Partial<typeof dimPost.$inferInsert> = {};
    if (typed.activity && !existing.activityUrn) patch.activityUrn = typed.activity;
    if (typed.share && !existing.shareUrn) patch.shareUrn = typed.share;
    if (typed.ugcPost && !existing.ugcUrn) patch.ugcUrn = typed.ugcPost;
    if (input.postId !== null && existing.postId !== input.postId) patch.postId = input.postId;
    // precision rule: a date-only publish date fills a gap but never overwrites.
    if (input.publishedAt && (input.publishedAt.precise || existing.publishedAt === null)) {
      patch.publishedAt = input.publishedAt.at;
    }
    if (Object.keys(patch).length > 0) {
      await tx.update(dimPost).set(patch).where(eq(dimPost.postUrn, existing.postUrn));
    }
    return existing.postUrn;
  }

  private async ingestSinglePost(tx: Tx, parsed: ParsedSinglePost, ctx: {
    urn: PostUrn; fileId: number; postId: number | null; asOfDate: string;
  }): Promise<{ profile: number; lifetime: number; window: number; audience: number }> {
    const publishedAt = new Date(parsed.publishedAt);
    const postUrn = await this.upsertDimPost(tx, {
      url: parsed.postUrl,
      urn: ctx.urn,
      publishedAt: Number.isNaN(publishedAt.getTime()) ? null : { at: publishedAt, precise: true },
      fileId: ctx.fileId,
      postId: ctx.postId,
    });

    const lifetime = dedupe(
      parsed.lifetime.map((r) => ({
        postUrn, metric: r.metric, asOfDate: ctx.asOfDate, value: r.value, sourceFileId: ctx.fileId,
      })),
      (r) => `${r.metric}`,
    );
    if (lifetime.length > 0) {
      await tx.insert(factPostLifetime).values(lifetime).onConflictDoUpdate({
        target: [factPostLifetime.postUrn, factPostLifetime.metric, factPostLifetime.asOfDate],
        set: { value: sqlExcluded('value'), sourceFileId: sqlExcluded('source_file_id') },
      });
    }

    const audience = await this.writeAudience(tx, parsed.audience, {
      postUrn, asOfDate: ctx.asOfDate, fileId: ctx.fileId,
    });
    return { profile: 0, lifetime: lifetime.length, window: 0, audience };
  }

  private async ingestAggregate(tx: Tx, parsed: ParsedAggregate, ctx: {
    fileId: number; warnings: string[];
  }): Promise<{ profile: number; lifetime: number; window: number; audience: number }> {
    // dim_post seeds first — the window rows resolve their urls through this map.
    const urnByUrl = new Map<string, string>();
    for (const seed of parsed.dimPosts) {
      const urn = extractPostUrn(seed.url);
      if (!urn) {
        ctx.warnings.push(`skipped a top-posts row: no post urn in ${seed.url}`);
        continue;
      }
      const publishedAt = seed.publishedAt === null ? null : dateOnlyToInstant(seed.publishedAt);
      urnByUrl.set(seed.url, await this.upsertDimPost(tx, {
        url: seed.url,
        urn,
        publishedAt: publishedAt === null ? null : { at: publishedAt, precise: false },
        fileId: ctx.fileId,
        // aggregate rows create/keep UNLINKED dim_posts: only a single-post export
        // (or an explicit ?postId=) attaches an app post.
        postId: null,
      }));
    }

    const profile = dedupe(
      parsed.profile.map((r) => ({
        metric: r.metric, date: r.date, value: r.value, sourceFileId: ctx.fileId,
      })),
      (r) => `${r.metric}\x1f${r.date}`,
    );
    if (profile.length > 0) {
      await tx.insert(factProfileMetric).values(profile).onConflictDoUpdate({
        target: [factProfileMetric.metric, factProfileMetric.date],
        set: { value: sqlExcluded('value'), sourceFileId: sqlExcluded('source_file_id') },
      });
    }

    const windowRows: (typeof factWindowMetric.$inferInsert)[] = [];
    for (const row of parsed.windowMetrics) {
      let postUrn: string | null = null;
      if (row.url !== null) {
        postUrn = urnByUrl.get(row.url) ?? null;
        if (postUrn === null) {
          ctx.warnings.push(`skipped a window metric: unresolvable post url ${row.url}`);
          continue;
        }
      }
      windowRows.push({
        postUrn,
        metric: row.metric,
        windowStart: parsed.window.start,
        windowEnd: parsed.window.end,
        value: row.value,
        sourceFileId: ctx.fileId,
      });
    }
    const windowMetrics = dedupe(windowRows, (r) => `${r.postUrn ?? ''}\x1f${r.metric}`);
    if (windowMetrics.length > 0) {
      await tx.insert(factWindowMetric).values(windowMetrics).onConflictDoUpdate({
        target: [
          factWindowMetric.postUrn, factWindowMetric.metric,
          factWindowMetric.windowStart, factWindowMetric.windowEnd,
        ],
        set: { value: sqlExcluded('value'), sourceFileId: sqlExcluded('source_file_id') },
      });
    }

    // The aggregate demographics sheet is account-wide and undated; the window's end
    // is the only capture instant the file carries.
    const audience = await this.writeAudience(tx, parsed.audience, {
      postUrn: null, asOfDate: parsed.window.end, fileId: ctx.fileId,
    });
    return { profile: profile.length, lifetime: 0, window: windowMetrics.length, audience };
  }

  private async writeAudience(tx: Tx, rows: AudienceRow[], ctx: {
    postUrn: string | null; asOfDate: string; fileId: number;
  }): Promise<number> {
    const values = dedupe(
      rows.map((r) => ({
        postUrn: ctx.postUrn,
        dimension: r.dimension,
        segment: r.segment,
        value: r.value,
        unit: r.unit,
        asOfDate: ctx.asOfDate,
        sourceFileId: ctx.fileId,
      })),
      (r) => `${r.dimension}\x1f${r.segment}`,
    );
    if (values.length === 0) return 0;
    await tx.insert(factAudienceSegment).values(values).onConflictDoUpdate({
      target: [
        factAudienceSegment.postUrn, factAudienceSegment.dimension,
        factAudienceSegment.segment, factAudienceSegment.asOfDate,
      ],
      set: {
        value: sqlExcluded('value'), unit: sqlExcluded('unit'), sourceFileId: sqlExcluded('source_file_id'),
      },
    });
    return values.length;
  }

  // -------------------------------------------------------------------------
  // Compat read layer — canonical rows pivoted back into the old snapshot shape.
  // -------------------------------------------------------------------------

  async forPost(postId: number): Promise<SnapshotRow[]> {
    return (await this.pivot(postId)).get(postId) ?? [];
  }

  /** Latest snapshot per post. Single-user data volume — in-memory grouping is fine. */
  async latestByPost(): Promise<Map<number, SnapshotRow>> {
    const byPost = await this.pivot();
    const out = new Map<number, SnapshotRow>();
    for (const [id, rows] of byPost) if (rows[0]) out.set(id, rows[0]);
    return out;
  }

  async countMeasuredSince(t: Date | null): Promise<number> {
    const measured = await this.posts.list({ status: ['measured'] });
    if (measured.length === 0) return 0;
    const latest = await this.latestByPost();
    return measured.filter((p) => {
      const snap = latest.get(p.id);
      if (!snap) return false;
      // `createdAt` is the source file's row-insert instant, never the backdated capture.
      return t === null || snap.createdAt > t;
    }).length;
  }

  /**
   * Profile-level aggregates for the Overview hero: current window vs the N days
   * immediately before it, weekday buckets, and the latest follower snapshot.
   *
   * `nowOverride` exists so tests can pin the clock; production always passes nothing.
   */
  async overview(window: number, nowOverride?: DateTime): Promise<OverviewDto> {
    const zone = OVERVIEW_ZONE; // pinned to the ingestion zone — spec §5. Do NOT read settings tz here.
    if (window !== 7 && window !== 28 && window !== 90) {
      throw new BadRequestException('window must be 7, 28 or 90');
    }
    const today = (nowOverride ?? DateTime.now().setZone(zone)).startOf('day');
    const curEnd = today; // inclusive
    const curStart = today.minus({ days: window - 1 });
    const prevEnd = curStart.minus({ days: 1 });
    const prevStart = prevEnd.minus({ days: window - 1 });

    // `fact_profile_metric.date` is a DATE column — compared as ISO strings.
    const dailyRows = await this.db.select({
      metric: factProfileMetric.metric,
      date: factProfileMetric.date,
      value: factProfileMetric.value,
    }).from(factProfileMetric).where(and(
      inArray(factProfileMetric.metric, [...DAILY_PROFILE_METRICS]),
      gte(factProfileMetric.date, prevStart.toISODate()!),
      lte(factProfileMetric.date, curEnd.toISODate()!),
    ));

    const [followerSnapshot] = await this.db.select({
      date: factProfileMetric.date, value: factProfileMetric.value,
    }).from(factProfileMetric).where(and(
      eq(factProfileMetric.metric, 'followers_total'),
      lte(factProfileMetric.date, today.toISODate()!),
    )).orderBy(desc(factProfileMetric.date)).limit(1);

    const publishedRows = await this.db.select({ publishedAt: postsTable.publishedAt })
      .from(postsTable).where(isNotNull(postsTable.publishedAt));
    const publishedDates = publishedRows.flatMap((r) => (
      r.publishedAt ? [DateTime.fromJSDate(r.publishedAt).setZone(zone).toISODate()!] : []
    ));

    const inRange = (date: string, start: DateTime, end: DateTime) =>
      date >= start.toISODate()! && date <= end.toISODate()!;

    const totals = (start: DateTime, end: DateTime): OverviewWindowTotals => {
      const rows = dailyRows.filter((r) => inRange(r.date, start, end));
      const sum = (metric: string) => rows
        .filter((r) => r.metric === metric)
        .reduce((acc, r) => acc + r.value, 0);
      return {
        start: start.toISODate()!,
        end: end.toISODate()!,
        impressions: sum('impressions'),
        engagements: sum('engagements'),
        followersNew: sum('followers_new'),
        postsPublished: publishedDates.filter((d) => inRange(d, start, end)).length,
        daysWithData: new Set(rows.map((r) => r.date)).size,
      };
    };

    const weekday = Array.from({ length: 7 }, (_, i) => (
      { weekday: i + 1, impressions: 0, engagements: 0 }
    ));
    for (const row of dailyRows) {
      if (!inRange(row.date, curStart, curEnd)) continue;
      const bucket = weekday[DateTime.fromISO(row.date, { zone }).weekday - 1];
      if (!bucket) continue;
      if (row.metric === 'impressions') bucket.impressions += row.value;
      else if (row.metric === 'engagements') bucket.engagements += row.value;
    }

    return {
      window,
      current: totals(curStart, curEnd),
      previous: totals(prevStart, prevEnd),
      weekday,
      followersTotal: followerSnapshot
        ? { value: followerSnapshot.value, asOf: followerSnapshot.date }
        : null,
    };
  }

  /**
   * The Analytics page's one read-only aggregate: the daily series and its window totals,
   * every `dim_post` the exports know, the latest account-level audience snapshot, and the
   * estimated spend of the runs that started inside the window.
   *
   * Day boundaries are pinned to the ingestion zone exactly like `overview()` — deliberately
   * NOT the settings zone (spec §6). `nowOverride` exists so tests can pin the clock;
   * production always passes nothing.
   */
  async board(range: BoardRange, nowOverride?: DateTime): Promise<BoardDto> {
    const zone = OVERVIEW_ZONE; // pinned to the ingestion zone — spec §6. Do NOT read settings tz here.
    if (!isBoardRange(range)) throw new BadRequestException('range must be 7, 28, 90 or all');

    const end = (nowOverride ?? DateTime.now().setZone(zone)).startOf('day'); // inclusive
    const earliest = range === 'all' ? await this.earliestBoardDay(zone) : null;
    const rawStart = range === 'all'
      ? (earliest ?? end) // empty DB → today; everything reads zero/empty
      : end.minus({ days: Number(range) - 1 });
    const start = rawStart > end ? end : rawStart;
    const startIso = start.toISODate()!;
    const endIso = end.toISODate()!;

    // `fact_profile_metric.date` is a DATE column — compared as ISO strings.
    const dailyRows = await this.db.select({
      metric: factProfileMetric.metric,
      date: factProfileMetric.date,
      value: factProfileMetric.value,
    }).from(factProfileMetric).where(and(
      inArray(factProfileMetric.metric, [...DAILY_PROFILE_METRICS]),
      gte(factProfileMetric.date, startIso),
      lte(factProfileMetric.date, endIso),
    ));

    // Only days carrying ≥1 imported daily row become points: the web draws the absent days
    // as gaps, and a zero-filled day would read as a real dip instead of missing data.
    const byDay = new Map<string, BoardSeriesPoint>();
    for (const row of dailyRows) {
      const point = byDay.get(row.date)
        ?? { date: row.date, impressions: 0, engagements: 0, followersNew: 0 };
      if (row.metric === 'impressions') point.impressions += row.value;
      else if (row.metric === 'engagements') point.engagements += row.value;
      else if (row.metric === 'followers_new') point.followersNew += row.value;
      byDay.set(row.date, point);
    }
    const series = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    const publishedRows = await this.db.select({ publishedAt: postsTable.publishedAt })
      .from(postsTable).where(isNotNull(postsTable.publishedAt));
    const postsPublished = publishedRows.filter((r) => {
      if (!r.publishedAt) return false;
      const day = DateTime.fromJSDate(r.publishedAt).setZone(zone).toISODate()!;
      return day >= startIso && day <= endIso;
    }).length;

    const totals: BoardTotals = {
      impressions: series.reduce((acc, p) => acc + p.impressions, 0),
      engagements: series.reduce((acc, p) => acc + p.engagements, 0),
      followersNew: series.reduce((acc, p) => acc + p.followersNew, 0),
      postsPublished,
    };

    // A sparse snapshot, not a daily row: the latest one at or before today, whatever the range.
    const [followerSnapshot] = await this.db.select({
      date: factProfileMetric.date, value: factProfileMetric.value,
    }).from(factProfileMetric).where(and(
      eq(factProfileMetric.metric, 'followers_total'),
      lte(factProfileMetric.date, endIso),
    )).orderBy(desc(factProfileMetric.date)).limit(1);

    const posts = await this.boardPosts();
    const audience = await this.boardAudience(endIso);
    const spend = await this.boardSpend(start, end, postsPublished, posts);

    return {
      range,
      start: startIso,
      end: endIso,
      series,
      totals,
      followersTotal: followerSnapshot
        ? { value: followerSnapshot.value, asOf: followerSnapshot.date }
        : null,
      posts,
      audience,
      spend,
    };
  }

  /**
   * Attach an imported urn to an app post by hand — the remedy for an import whose post
   * the matcher could not resolve (no url on the post yet, or a different urn type).
   *
   * Mirrors ingestion's post-link behavior rather than inventing a second one: the measured
   * transition runs through `applyMeasured`, so a published post becomes measured, a measured
   * one no-ops, and anything else stays linked with a warning — linking never fails over an
   * app-side status. It only runs when the urn actually carries lifetime facts: a urn known
   * only from the aggregate top-posts sheet has no per-post measurement to justify the move.
   */
  async link(postUrn: string, postId: number): Promise<LinkResult> {
    const [dim] = await this.db.select().from(dimPost).where(eq(dimPost.postUrn, postUrn));
    if (!dim) throw new NotFoundException(`post urn ${postUrn} not found`);
    const post = await this.posts.get(postId); // NotFound propagates

    // Two sides to guard, and the target-side query structurally cannot see the source one.
    // SOURCE: this urn already belongs to a DIFFERENT post. Reassigning it would silently strip
    // that post of its measurements while leaving its `measured` status behind — unreachable from
    // the UI (the attach pill only renders on unlinked rows) but the endpoint is callable directly.
    if (dim.postId !== null && dim.postId !== postId) {
      throw new ConflictException(`post urn ${postUrn} is already linked to post ${dim.postId}`);
    }

    // TARGET: some other urn already claims this post.
    const [taken] = await this.db.select({ postUrn: dimPost.postUrn })
      .from(dimPost)
      .where(and(eq(dimPost.postId, postId), ne(dimPost.postUrn, postUrn)))
      .limit(1);
    if (taken) {
      throw new ConflictException(`post ${postId} is already linked to ${taken.postUrn}`);
    }

    if (dim.postId !== postId) {
      await this.db.update(dimPost).set({ postId }).where(eq(dimPost.postUrn, postUrn));
    }

    const warnings: string[] = [];
    const [fact] = await this.db.select({ postUrn: factPostLifetime.postUrn })
      .from(factPostLifetime).where(eq(factPostLifetime.postUrn, postUrn)).limit(1);
    if (fact) await this.applyMeasured(post, warnings);

    return { postUrn, postId, warnings };
  }

  /**
   * The post-detail page's one read-only aggregate: what this post's urns measured (latest per
   * metric + the impressions series over capture days), its own demographics snapshot, and the
   * estimated cost of every run that produced it.
   *
   * Read across ALL urn forms of the post: LinkedIn exports the same post under share and
   * activity urns, so a metric a second form carries is still this post's. Where two forms
   * report the SAME metric on the SAME day the greater value wins — summing would double-count
   * one post (the board's dedupe rule, applied per metric here).
   *
   * 404 comes from `posts.get`, before any fact is read.
   */
  async postDetail(postId: number): Promise<PostDetailDto> {
    const post = await this.posts.get(postId); // NotFound propagates
    const dims = await this.db.select().from(dimPost).where(eq(dimPost.postId, postId));
    const urns = dims.map((d) => d.postUrn);

    const lifetime = urns.length === 0 ? [] : await this.db.select({
      metric: factPostLifetime.metric,
      asOfDate: factPostLifetime.asOfDate,
      value: factPostLifetime.value,
    }).from(factPostLifetime).where(inArray(factPostLifetime.postUrn, urns));

    const latestByMetric = new Map<string, PostDetailMetric>();
    const impressionsByDay = new Map<string, number>();
    for (const row of lifetime) {
      const held = latestByMetric.get(row.metric);
      const newer = !held
        || row.asOfDate > held.asOf
        || (row.asOfDate === held.asOf && row.value > held.value);
      if (newer) latestByMetric.set(row.metric, { metric: row.metric, value: row.value, asOf: row.asOfDate });
      if (row.metric === 'impressions') {
        impressionsByDay.set(row.asOfDate, Math.max(impressionsByDay.get(row.asOfDate) ?? 0, row.value));
      }
    }

    return {
      post: {
        id: post.id,
        title: postLabel(post),
        tier: post.tier,
        // `dim_post`'s timestamp is never downgraded, so it wins; the app row is the fallback.
        publishedAt: (dims.find((d) => d.publishedAt !== null)?.publishedAt ?? post.publishedAt ?? null)
          ?.toISOString() ?? null,
        linkedinUrl: post.linkedinUrl ?? dims.find((d) => d.linkedinUrl)?.linkedinUrl ?? null,
      },
      // Alphabetical: the page names the metrics it renders, so the payload only owes it determinism.
      latest: [...latestByMetric.values()].sort((a, b) => (a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : 0)),
      series: [...impressionsByDay]
        .map(([asOf, impressions]) => ({ asOf, impressions }))
        .sort((a, b) => (a.asOf < b.asOf ? -1 : 1)),
      audience: await this.postAudience(urns),
      runs: await this.postRuns(postId),
    };
  }

  /** This post's newest demographics snapshot — the account-level rows are a different surface. */
  private async postAudience(urns: string[]): Promise<BoardAudience | null> {
    if (urns.length === 0) return null;
    const [latest] = await this.db.select({ asOfDate: factAudienceSegment.asOfDate })
      .from(factAudienceSegment).where(inArray(factAudienceSegment.postUrn, urns))
      .orderBy(desc(factAudienceSegment.asOfDate)).limit(1);
    if (!latest) return null;

    const rows = await this.db.select({
      dimension: factAudienceSegment.dimension,
      segment: factAudienceSegment.segment,
      value: factAudienceSegment.value,
      unit: factAudienceSegment.unit,
    }).from(factAudienceSegment).where(and(
      inArray(factAudienceSegment.postUrn, urns),
      eq(factAudienceSegment.asOfDate, latest.asOfDate),
    )).orderBy(desc(factAudienceSegment.value), factAudienceSegment.id);

    const byDimension = new Map<string, BoardAudienceSegment[]>();
    for (const row of rows) {
      const segments = byDimension.get(row.dimension) ?? [];
      // Two urn forms can carry the same segment at the same capture; keep it once.
      if (segments.some((s) => s.segment === row.segment)) continue;
      segments.push({ segment: row.segment, value: row.value, unit: row.unit });
      byDimension.set(row.dimension, segments);
    }
    return {
      asOf: latest.asOfDate,
      dimensions: [...byDimension].map(([dimension, segments]) => ({ dimension, segments })),
    };
  }

  /**
   * Every run attached to this post, newest first, with the cost recorded on it at call time
   * (a managed run's is already the sum of its steps).
   */
  private async postRuns(postId: number): Promise<PostDetailRuns> {
    const rows = await this.db.select({
      id: runsTable.id,
      kind: runsTable.kind,
      engine: runsTable.engine,
      model: runsTable.model,
      // numeric comes back from drizzle as a string; the cast answers a number.
      costUsd: sql<number | null>`${runsTable.costUsd}::float8`,
    }).from(runsTable).where(eq(runsTable.postId, postId))
      .orderBy(desc(runsTable.startedAt), desc(runsTable.id));
    if (rows.length === 0) return { total: null, items: [] };

    let total: number | null = null;
    const items = rows.map((run) => {
      // An unpriced run contributes nothing — not a zero, which would read as "free".
      if (run.costUsd !== null) total = (total ?? 0) + run.costUsd;
      return { runId: run.id, kind: run.kind, engine: run.engine, model: run.model, costUsd: run.costUsd };
    });
    return { total, items };
  }

  /**
   * `range=all`'s lower bound: the earliest day ANY data exists on. Runs are included
   * deliberately — they predate and outlive the imports, and clipping to the fact tables
   * would silently truncate spend history (review-wave finding). Null when the DB is empty.
   */
  private async earliestBoardDay(zone: string): Promise<DateTime | null> {
    const [profile] = await this.db.select({ day: factProfileMetric.date })
      .from(factProfileMetric).orderBy(asc(factProfileMetric.date)).limit(1);
    const [lifetime] = await this.db.select({ day: factPostLifetime.asOfDate })
      .from(factPostLifetime).orderBy(asc(factPostLifetime.asOfDate)).limit(1);
    const [audience] = await this.db.select({ day: factAudienceSegment.asOfDate })
      .from(factAudienceSegment).orderBy(asc(factAudienceSegment.asOfDate)).limit(1);
    const [run] = await this.db.select({ startedAt: runsTable.startedAt })
      .from(runsTable).orderBy(asc(runsTable.startedAt)).limit(1);

    const days = [
      profile?.day,
      lifetime?.day,
      audience?.day,
      run ? DateTime.fromJSDate(run.startedAt).setZone(zone).toISODate()! : undefined,
    ].filter((d): d is string => typeof d === 'string');
    if (days.length === 0) return null;
    return DateTime.fromISO(days.reduce((a, b) => (a < b ? a : b)), { zone }).startOf('day');
  }

  /**
   * Every post the exports know — `dim_post` is the source, not `posts`, so unlinked imports
   * appear too. Range-independent by design: the range scopes the account series and spend,
   * while this list is "everything, best-known", which the page's tabs re-sort.
   *
   * Grain rule (spec §1): lifetime facts win; a dim_post seeded only by the aggregate
   * top-posts sheet falls back to its MAX window impressions and carries NO derived stats,
   * because a lifetime rate can never be computed from a windowed count.
   */
  private async boardPosts(): Promise<BoardPostRow[]> {
    const dims = await this.db.select().from(dimPost);
    if (dims.length === 0) return [];
    const urns = dims.map((d) => d.postUrn);

    const lifetime = await this.db.select({
      postUrn: factPostLifetime.postUrn,
      metric: factPostLifetime.metric,
      asOfDate: factPostLifetime.asOfDate,
      value: factPostLifetime.value,
    }).from(factPostLifetime).where(inArray(factPostLifetime.postUrn, urns));

    // `fact_window_metric` is read ONLY for the grain fallback — nothing else on this surface.
    const windowed = await this.db.select({
      postUrn: factWindowMetric.postUrn, value: factWindowMetric.value,
    }).from(factWindowMetric).where(and(
      isNotNull(factWindowMetric.postUrn),
      eq(factWindowMetric.metric, 'impressions'),
    ));

    // Latest value PER METRIC, not per source file: a metric-poor recent export must not
    // erase a metric a richer older one carried.
    const latestByUrn = new Map<string, Map<string, { asOfDate: string; value: number }>>();
    for (const row of lifetime) {
      const perMetric = latestByUrn.get(row.postUrn) ?? new Map();
      const held = perMetric.get(row.metric);
      if (!held || row.asOfDate > held.asOfDate) {
        perMetric.set(row.metric, { asOfDate: row.asOfDate, value: row.value });
      }
      latestByUrn.set(row.postUrn, perMetric);
    }
    const maxWindowByUrn = new Map<string, number>();
    for (const row of windowed) {
      if (row.postUrn === null) continue;
      maxWindowByUrn.set(row.postUrn, Math.max(maxWindowByUrn.get(row.postUrn) ?? 0, row.value));
    }

    const linkedIds = [...new Set(dims.flatMap((d) => (d.postId === null ? [] : [d.postId])))];
    const appPosts = linkedIds.length === 0
      ? []
      : await this.db.select().from(postsTable).where(inArray(postsTable.id, linkedIds));
    const appPostById = new Map(appPosts.map((p) => [p.id, p]));

    const rows: BoardPostRow[] = [];
    for (const dim of dims) {
      const app = dim.postId === null ? undefined : appPostById.get(dim.postId);
      const identity = {
        postUrn: dim.postUrn,
        postId: dim.postId,
        title: app ? postLabel(app) : null,
        linkedinUrl: dim.linkedinUrl,
        // dim_post's timestamp is never downgraded, so it wins; the app row is the fallback.
        publishedAt: (dim.publishedAt ?? app?.publishedAt ?? null)?.toISOString() ?? null,
      };
      const perMetric = latestByUrn.get(dim.postUrn);
      if (perMetric && perMetric.size > 0) {
        const value = (metric: string) => perMetric.get(metric)?.value ?? null;
        const impressions = value('impressions') ?? 0;
        const reactions = value('reactions') ?? 0;
        const comments = value('comments') ?? 0;
        const shares = value('reposts') ?? 0; // LinkedIn exports "reposts" as the share count
        rows.push({
          ...identity,
          grain: 'lifetime',
          impressions,
          engagements: reactions + comments + shares,
          er: engagementRate({ reactions, comments, shares, impressions }),
          followsGained: value('follows_gained'),
        });
      } else if (maxWindowByUrn.has(dim.postUrn)) {
        rows.push({
          ...identity,
          grain: 'window',
          impressions: maxWindowByUrn.get(dim.postUrn)!,
          engagements: null,
          er: null,
          followsGained: null,
        });
      }
      // Neither grain → the post is omitted: there is nothing to show for it.
    }

    // Dedupe guard (spec §5): two urn forms of one app post collapse to the better-measured
    // row. Unlinked rows can never collide, so they pass through untouched.
    // GRAIN is the primary key, impressions only the tiebreak inside a grain: a window row's
    // number and a lifetime row's number are not comparable quantities, so ranking them together
    // lets a big 7-day count evict the post's real lifetime measurement (and with it `er`,
    // `followsGained`, and the row's eligibility for `spend.byPost`). Lifetime always wins.
    const grainRank = (r: BoardPostRow) => (r.grain === 'lifetime' ? 1 : 0);
    const winnerByPostId = new Map<number, BoardPostRow>();
    const unlinked: BoardPostRow[] = [];
    for (const row of rows) {
      if (row.postId === null) { unlinked.push(row); continue; }
      const held = winnerByPostId.get(row.postId);
      const wins = !held
        || grainRank(row) > grainRank(held)
        || (grainRank(row) === grainRank(held) && (
          row.impressions > held.impressions
          || (row.impressions === held.impressions && row.postUrn < held.postUrn)
        ));
      if (wins) winnerByPostId.set(row.postId, row);
    }

    // Server-guaranteed order so the mixed-grain sort is unit-testable; the web re-sorts for
    // its own tabs.
    return [...winnerByPostId.values(), ...unlinked].sort((a, b) => (
      b.impressions - a.impressions || (a.postUrn < b.postUrn ? -1 : a.postUrn > b.postUrn ? 1 : 0)
    ));
  }

  /**
   * The latest account-level (`post_urn IS NULL`) demographics snapshot at or before `endIso`.
   * Values are passed through verbatim with their stored `unit` — percents stay percents and
   * are never re-derived against a total the sheet did not give us.
   */
  private async boardAudience(endIso: string): Promise<BoardAudience | null> {
    const [latest] = await this.db.select({ asOfDate: factAudienceSegment.asOfDate })
      .from(factAudienceSegment).where(and(
        isNull(factAudienceSegment.postUrn),
        lte(factAudienceSegment.asOfDate, endIso),
      )).orderBy(desc(factAudienceSegment.asOfDate)).limit(1);
    if (!latest) return null;

    const rows = await this.db.select({
      dimension: factAudienceSegment.dimension,
      segment: factAudienceSegment.segment,
      value: factAudienceSegment.value,
      unit: factAudienceSegment.unit,
    }).from(factAudienceSegment).where(and(
      isNull(factAudienceSegment.postUrn),
      eq(factAudienceSegment.asOfDate, latest.asOfDate),
    )).orderBy(desc(factAudienceSegment.value), factAudienceSegment.id);

    const byDimension = new Map<string, BoardAudienceSegment[]>();
    for (const row of rows) {
      const segments = byDimension.get(row.dimension) ?? [];
      segments.push({ segment: row.segment, value: row.value, unit: row.unit });
      byDimension.set(row.dimension, segments);
    }
    return {
      asOf: latest.asOfDate,
      dimensions: [...byDimension].map(([dimension, segments]) => ({ dimension, segments })),
    };
  }

  /**
   * Spend for the runs that STARTED inside the window (day boundaries in the same pinned zone),
   * from the cost recorded on each run at call time.
   */
  private async boardSpend(
    start: DateTime, end: DateTime, postsPublished: number, posts: BoardPostRow[],
  ): Promise<BoardSpend> {
    const inRange = await this.db.select({
      id: runsTable.id,
      kind: runsTable.kind,
      postId: runsTable.postId,
      costUsd: sql<number | null>`${runsTable.costUsd}::float8`,
    }).from(runsTable).where(and(
      gte(runsTable.startedAt, start.startOf('day').toJSDate()),
      lte(runsTable.startedAt, end.endOf('day').toJSDate()),
    ));

    let total = 0;
    const totalByKind = new Map<RunKind, number>();
    /** null = the post's in-range runs are all unpriced, which keeps it out of `byPost`. */
    const costByPostId = new Map<number, number | null>();

    for (const run of inRange) {
      const cost = run.costUsd;
      total += cost ?? 0; // unpriced runs contribute 0 but still count in `runs`
      totalByKind.set(run.kind, (totalByKind.get(run.kind) ?? 0) + (cost ?? 0));
      if (run.postId !== null) {
        const held = costByPostId.get(run.postId);
        costByPostId.set(run.postId, cost === null ? held ?? null : (held ?? 0) + cost);
      }
    }

    // LIFETIME rows only (spec §6: runs → posts → lifetime impressions). A window row's
    // impressions are a windowed count, so pairing it with a run's cost would rank a 7-day number
    // against another post's all-time number in one "cost vs return" list — deriving across
    // grains, which this page never does.
    const linked = new Map(posts.flatMap(
      (p) => (p.postId === null || p.grain !== 'lifetime' ? [] : [[p.postId, p] as const]),
    ));
    const byPost: BoardSpendByPost[] = [];
    for (const [postId, cost] of costByPostId) {
      const post = linked.get(postId);
      // "was it worth it" needs BOTH sides — no cost or no lifetime measurement, no row.
      if (cost === null || !post || post.impressions <= 0) continue;
      byPost.push({ postId, title: post.title ?? `post #${postId}`, cost, impressions: post.impressions });
    }
    byPost.sort((a, b) => b.cost - a.cost || a.postId - b.postId);

    return {
      total,
      runs: inRange.length,
      perPublishedPost: postsPublished > 0 ? total / postsPublished : null,
      byKind: [...totalByKind]
        .map(([kind, kindTotal]) => ({ kind, total: kindTotal }))
        .sort((a, b) => b.total - a.total || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
      byPost,
    };
  }

  /**
   * One synthetic snapshot per (app post, `as_of_date`) — grouping by day rather than by
   * source file, so two same-day exports carrying different metric sets read as one row
   * instead of two fragmentary ones. Newest day first.
   */
  private async pivot(postId?: number): Promise<Map<number, SnapshotRow[]>> {
    const dims = await this.db.select().from(dimPost)
      .where(postId === undefined ? isNotNull(dimPost.postId) : eq(dimPost.postId, postId));
    const postByUrn = new Map<string, number>();
    for (const d of dims) if (d.postId !== null) postByUrn.set(d.postUrn, d.postId);
    if (postByUrn.size === 0) return new Map();

    const urns = [...postByUrn.keys()];
    const lifetime = await this.db.select().from(factPostLifetime)
      .where(inArray(factPostLifetime.postUrn, urns));
    const audience = await this.db.select().from(factAudienceSegment)
      .where(inArray(factAudienceSegment.postUrn, urns))
      // percent-descending, which is the sheet's own order. Insertion order would be
      // equivalent for live imports, but migration 0010 backfilled alphabetically by
      // (dimension, segment), so serial id encodes the wrong order for legacy rows.
      .orderBy(desc(factAudienceSegment.value), factAudienceSegment.id);
    const fileIds = [...new Set([
      ...lifetime.map((r) => r.sourceFileId), ...audience.map((r) => r.sourceFileId),
    ])];
    const files = fileIds.length === 0
      ? []
      : await this.db.select().from(sourceFiles).where(inArray(sourceFiles.id, fileIds));
    const fileById = new Map(files.map((f) => [f.id, f]));

    interface Group {
      postId: number;
      asOfDate: string;
      metrics: Map<string, number>;
      audience: AudienceFactRow[];
      newest: SourceFileRow | null;
    }
    const groups = new Map<string, Group>();
    const groupFor = (urn: string, asOfDate: string, sourceFileId: number): Group | null => {
      const owner = postByUrn.get(urn);
      if (owner === undefined) return null;
      const key = `${owner}\x1f${asOfDate}`;
      let group = groups.get(key);
      if (!group) {
        group = { postId: owner, asOfDate, metrics: new Map(), audience: [], newest: null };
        groups.set(key, group);
      }
      const file = fileById.get(sourceFileId) ?? null;
      if (file && (group.newest === null || isNewer(file, group.newest))) group.newest = file;
      return group;
    };

    for (const row of lifetime) {
      const group = groupFor(row.postUrn, row.asOfDate, row.sourceFileId);
      group?.metrics.set(row.metric, row.value);
    }
    for (const row of audience) {
      if (row.postUrn === null) continue;
      groupFor(row.postUrn, row.asOfDate, row.sourceFileId)?.audience.push(row);
    }

    const dated = new Map<number, { row: SnapshotRow; asOfDate: string }[]>();
    for (const group of groups.values()) {
      if (group.newest === null) continue; // orphaned facts: no file left to date them
      const rows = dated.get(group.postId) ?? [];
      rows.push({
        row: toSnapshotRow(group.postId, group.metrics, group.audience, group.newest),
        asOfDate: group.asOfDate,
      });
      dated.set(group.postId, rows);
    }
    const out = new Map<number, SnapshotRow[]>();
    for (const [postId, rows] of dated) {
      // `as_of_date` breaks the tie when one source file dates several days: without it the
      // order would fall out of an unordered SELECT, so "latest" could differ across calls.
      rows.sort((a, b) => b.row.capturedAt.getTime() - a.row.capturedAt.getTime()
        || b.asOfDate.localeCompare(a.asOfDate)
        || b.row.id - a.row.id);
      out.set(postId, rows.map((r) => r.row));
    }
    return out;
  }
}

/** `imported_at` desc, id as the tiebreaker — the "newest contributing source file". */
function isNewer(a: SourceFileRow, b: SourceFileRow): boolean {
  const delta = a.importedAt.getTime() - b.importedAt.getTime();
  return delta === 0 ? a.id > b.id : delta > 0;
}

function toSnapshotRow(
  postId: number, metrics: Map<string, number>, audience: AudienceFactRow[], file: SourceFileRow,
): SnapshotRow {
  const demographics = audience.length === 0 ? null : emptyDemographics();
  if (demographics) {
    for (const row of audience) {
      const key = DEMOGRAPHIC_KEYS[row.dimension];
      if (key) demographics[key].push({ value: row.segment, percent: row.value } satisfies DemoRow);
    }
  }
  // The legacy columns behind these five were NOT NULL; everything else was nullable.
  const [impressions, reactions, comments, reposts, saves] =
    REQUIRED_COMPAT_METRICS.map((m) => metrics.get(m) ?? 0);
  return {
    id: file.id,
    postId,
    capturedAt: file.importedAt,
    createdAt: file.createdAt,
    rawFilePath: file.rawPath,
    impressions: impressions ?? 0,
    membersReached: metrics.get('members_reached') ?? null,
    reactions: reactions ?? 0,
    comments: comments ?? 0,
    shares: reposts ?? 0,
    saves: saves ?? 0,
    followsGained: metrics.get('follows_gained') ?? null,
    profileViews: metrics.get('profile_views') ?? null,
    demographics,
  };
}

/**
 * Postgres refuses an `ON CONFLICT DO UPDATE` batch that touches the same key twice
 * (SQLSTATE 21000). Parsers already dedupe on their own grain, but url→urn resolution
 * can still collapse two rows onto one key, so the last write wins here too.
 */
function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(key(row), row);
  return [...byKey.values()];
}

/** `excluded.<column>` — the proposed row inside an upsert's DO UPDATE clause. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}
