import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import {
  RefineSelectionOutputSchema, extractJson, sameSources,
  type PostStatus, type PostTier, type Source,
} from '@forge/shared';
import { DB, ForgeDb } from '../db/client';
import { assets, ideas, postRevisions, posts, runs } from '../db/schema';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { RunsService } from '../runs/runs.service';
import { bgPathFor, readPngSize, removePostAssets } from '../images/asset-store';
import { removePostInputs } from '../inputs/inputs-store';

export type PostRow = typeof posts.$inferSelect;
export type RevisionRow = typeof postRevisions.$inferSelect;

/**
 * One body write. At least one of `body`, `sources` or `appendFromRunId`, or it is a 400.
 * `source` is the Revision's origin and is always required: under the old positional signature a
 * missed caller would leave it undefined against a NOT NULL column, so a miss fails loudly.
 */
export type BodyWrite = {
  /** Omitted: the body and the derived hook do not change. */
  body?: string;
  /** Omitted: the post's Sources do not change. An empty list is an explicit clear. */
  sources?: Source[];
  /** A succeeded refine_selection run on this post: its Sources are appended, deduplicated. */
  appendFromRunId?: number;
  /** 'run:<id>' | 'manual_edit' */
  source: string;
};

/**
 * Append `incoming` to `existing`, keyed on `ref` compared exactly after trim. A ref already
 * present is dropped and the entry already there keeps its note: the operator's wording outranks
 * the model's on the second sighting of the same source.
 */
export function dedupAppend(existing: Source[], incoming: Source[]): Source[] {
  const seen = new Set(existing.map((s) => s.ref.trim()));
  return [...existing, ...incoming.filter((s) => {
    const ref = s.ref.trim();
    if (seen.has(ref)) return false;
    seen.add(ref); // an incoming list that repeats a ref within itself lands once
    return true;
  })];
}

/** What the selected asset contributes to a list row: enough to draw the miniature. */
export interface SelectedAssetRef { id: number; width: number | null; height: number | null }
/** A post as the list shows it: the row, the idea it came from, and its selected image. */
export type PostListItem = PostRow & { ideaText: string | null; selectedAsset: SelectedAssetRef | null };

/** Max length of a derived post label; long bodies are cut, never wrapped. */
const LABEL_MAX = 80;

/**
 * The human-facing name of a post for list surfaces (planner lanes, queue, dashboard).
 * A post has no title column: the hook is it once drafted, the body stands in while drafting,
 * and a bare `post #id` covers a freshly queued post with neither.
 */
export function postLabel(p: Pick<PostRow, 'id' | 'hook' | 'bodyLinkedin'>): string {
  return (p.hook ?? p.bodyLinkedin ?? `post #${p.id}`).slice(0, LABEL_MAX);
}

@Injectable()
export class PostsService {
  private readonly log = new Logger(PostsService.name);

  constructor(
    @Inject(DB) private readonly db: ForgeDb,
    private readonly embeddings: EmbeddingsService,
    private readonly runs: RunsService,
  ) {}

  async create(input: { tier: PostTier }): Promise<PostRow> {
    const [row] = await this.db.insert(posts)
      .values({ tier: input.tier })
      .returning();
    return row!;
  }

  async get(id: number): Promise<PostRow> {
    const [row] = await this.db.select().from(posts).where(eq(posts.id, id));
    if (!row) throw new NotFoundException(`post ${id} not found`);
    return row;
  }

  /**
   * Scalar subqueries, not joins: neither `ideas.promoted_post_id` nor `assets.is_selected` is
   * unique, so a join could return a post twice. Each subquery takes the newest match by id.
   */
  async list(filter: { status?: PostStatus[] } = {}): Promise<PostListItem[]> {
    const rows = await this.db.select({
      ...getTableColumns(posts),
      // `posts.id` is written out, not interpolated: in a single-table select drizzle renders an
      // interpolated column bare (`"id"`), which inside the subquery binds to the inner table's id.
      ideaText: sql<string | null>`(select ideas.raw_text from ideas where ideas.promoted_post_id = posts.id order by ideas.id desc limit 1)`,
      selectedAsset: sql<SelectedAssetRef | null>`(select jsonb_build_object('id', assets.id, 'width', assets.width, 'height', assets.height) from assets where assets.post_id = posts.id and assets.is_selected order by assets.id desc limit 1)`,
    }).from(posts)
      .where(filter.status && filter.status.length > 0 ? inArray(posts.status, filter.status) : undefined)
      .orderBy(desc(posts.createdAt));
    return rows.map((r) => ({ ...r, ideaText: r.ideaText ?? null, selectedAsset: r.selectedAsset ?? null }));
  }

  /**
   * Posts whose free-form `scheduled_date` falls in `[fromDate, toDateExclusive)`, unpublished only —
   * a published post is placed by its publish day, never by the date it was once scheduled for.
   * Both bounds are ISO dates ('YYYY-MM-DD'); the column is `date` in string mode, so lexicographic
   * comparison is the calendar comparison.
   */
  async scheduledInRange(fromDate: string, toDateExclusive: string): Promise<PostRow[]> {
    return this.db.select().from(posts)
      .where(and(
        isNull(posts.publishedAt),
        isNotNull(posts.scheduledDate),
        gte(posts.scheduledDate, fromDate),
        lt(posts.scheduledDate, toDateExclusive),
      ))
      .orderBy(posts.scheduledDate);
  }

  async findByUrl(linkedinUrl: string): Promise<PostRow | null> {
    // linkedin_url has no unique index — newest-first keeps this deterministic
    // (and correct for re-published urls; test suites also rely on it).
    const [row] = await this.db.select().from(posts)
      .where(eq(posts.linkedinUrl, linkedinUrl))
      .orderBy(desc(posts.id)).limit(1);
    return row ?? null;
  }

  async detail(id: number) {
    const post = await this.get(id);
    const revisions = await this.db.select().from(postRevisions)
      .where(eq(postRevisions.postId, id)).orderBy(desc(postRevisions.createdAt), desc(postRevisions.id));
    const latestDraft = await this.runs.latestForPost(id, 'draft');
    return { post, revisions, latestDraft };
  }

  async beginDrafting(id: number): Promise<PostRow> {
    const [row] = await this.db.update(posts)
      .set({ status: 'drafting', updatedAt: new Date() })
      .where(and(eq(posts.id, id), inArray(posts.status, ['queued', 'draft_ready'])))
      .returning();
    if (!row) {
      await this.get(id); // 404 if missing
      throw new ConflictException(`post ${id} cannot start drafting from its current status`);
    }
    return row;
  }

  async endDrafting(id: number): Promise<void> {
    const post = await this.get(id);
    if (post.status !== 'drafting') return; // finalize is best-effort; never throws over state
    await this.db.update(posts)
      .set({ status: post.bodyLinkedin ? 'draft_ready' : 'queued', updatedAt: new Date() })
      .where(and(eq(posts.id, id), eq(posts.status, 'drafting')));
  }

  /**
   * The Sources a run offers to a body save. A run that is not this post's is a 404, and so is one
   * that does not exist: `sourceRunId` used to be pure attribution accepting any number, and now
   * that it drives a write it has to name something real. Any other kind or status offers nothing,
   * which is not an error: accepting a proposal from a run that returned no Sources is normal.
   */
  private async sourcesFromRun(postId: number, runId: number): Promise<Source[]> {
    // A missing run is `RunsService.get`'s own 404, so nothing is classified here.
    const run = await this.runs.get(runId);
    if (run.postId !== postId) throw new NotFoundException(`run ${runId} is not on post ${postId}`);
    if (run.kind !== 'refine_selection' || run.status !== 'succeeded' || !run.output) return [];
    try {
      return RefineSelectionOutputSchema.parse(extractJson(run.output)).sources ?? [];
    } catch {
      // An unparseable output is a run detail problem, never a reason to refuse the body save.
      return [];
    }
  }

  /**
   * The single write seam for a post's body and its Sources. Every caller lands here, so every
   * Revision snapshots both, and the refine append happens inside the same transaction that
   * writes it. An omitted `body` leaves the body and hook alone; omitted `sources` leaves the
   * list alone; `appendFromRunId` appends the named run's list to what the post already has.
   */
  async updateBody(id: number, write: BodyWrite): Promise<void> {
    if (write.body === undefined && write.sources === undefined && write.appendFromRunId === undefined) {
      throw new BadRequestException('a body write needs a body, sources or a source run');
    }
    const incoming = write.appendFromRunId === undefined
      ? undefined
      : await this.sourcesFromRun(id, write.appendFromRunId);
    // hook is derived: first non-empty trimmed line of the body, written in the same transaction
    const hook = write.body === undefined
      ? null
      : write.body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? null;
    await this.db.transaction(async (tx) => {
      // FOR UPDATE, because the Sources write is a read-modify-write: the append path merges
      // against what it read. Without the lock two concurrent writes both compute from the same
      // base under READ COMMITTED and the second silently reverts the first. It also closes the
      // window between the measured gate below and the update.
      const [post] = await tx.select().from(posts).where(eq(posts.id, id)).for('update');
      if (!post) throw new NotFoundException(`post ${id} not found`);
      if (post.status === 'measured') throw new ConflictException('post is measured; its body is final');
      // The operator's explicit list beats the run's append, which beats leaving the list alone.
      const appended = incoming === undefined ? undefined : dedupAppend(post.sources, incoming);
      const nextSources = write.sources ?? appended ?? post.sources;
      // A sources-only save snapshots the body the post has now, so the Revision is a whole state.
      const nextBody = write.body ?? post.bodyLinkedin ?? '';
      await tx.insert(postRevisions).values({ postId: id, body: nextBody, sources: nextSources, source: write.source });
      await tx.update(posts).set({
        ...(write.body !== undefined ? { bodyLinkedin: write.body, hook } : {}),
        ...(sameSources(nextSources, post.sources) ? {} : { sources: nextSources }),
        updatedAt: new Date(),
      }).where(eq(posts.id, id));
    });
    // body-only: the hook is a substring of the body now — joining would double-count the first line
    if (write.body !== undefined) await this.embeddings.upsertFor('post', id, write.body);
  }

  /** On a measured post nothing is editable. The gate sits inside the same row lock `updateBody`
   *  uses, so the window between reading the status and writing the row is closed. */
  async patchMeta(id: number, patch: {
    hook?: string; imagePrompt?: string; hashtags?: string[]; topicTags?: string[];
  }): Promise<PostRow> {
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(posts).where(eq(posts.id, id)).for('update');
      if (!current) throw new NotFoundException(`post ${id} not found`);
      if (current.status === 'measured') throw new ConflictException('post is measured; its body is final');
      const [updated] = await tx.update(posts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(posts.id, id)).returning();
      return updated;
    });
    if (!row) throw new NotFoundException(`post ${id} not found`);
    if (patch.hook !== undefined && row.bodyLinkedin) {
      await this.embeddings.upsertFor('post', id, [row.hook, row.bodyLinkedin].filter(Boolean).join('\n\n'));
    }
    return row;
  }

  /**
   * Full-state schedule write: `null` unschedules, otherwise date (+ optional time) replaces
   * whatever was stored — an absent time clears it.
   */
  async setSchedule(id: number, schedule: { date: string; time: string | null } | null): Promise<PostRow> {
    const post = await this.get(id); // 404 if missing
    if (post.publishedAt !== null) throw new BadRequestException(`post ${id} is published; its schedule is final`);
    if (schedule) {
      // the regex only proves the SHAPE — 2027-13-40 and 25:99 need a real calendar check
      const parsed = DateTime.fromISO(schedule.date);
      if (!parsed.isValid) {
        throw new BadRequestException(`invalid calendar date '${schedule.date}'`);
      }
      // luxon happily parses year 0 (and years past 9999); Postgres `date` does not, so the driver
      // error would escape as a 500. Bound the year here, where the contract promises a 400.
      if (parsed.year < 1 || parsed.year > 9999) {
        throw new BadRequestException(`date '${schedule.date}' is outside the supported year range`);
      }
      if (schedule.time !== null && !DateTime.fromISO(`${schedule.date}T${schedule.time}`).isValid) {
        throw new BadRequestException(`invalid time of day '${schedule.time}'`);
      }
    }
    const [row] = await this.db.update(posts)
      .set({
        scheduledDate: schedule?.date ?? null,
        scheduledTime: schedule?.time ?? null,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id)).returning();
    return row!;
  }

  async approve(id: number): Promise<void> {
    const post = await this.get(id);
    if (!post.bodyLinkedin) throw new ConflictException('approve requires a body');
    await this.transition(id, ['draft_ready'], { status: 'approved' });
  }

  async publish(id: number, input: { linkedinUrl: string; publishedAt?: Date }): Promise<void> {
    if (!input.linkedinUrl) throw new ConflictException('publish requires the linkedin url');
    // published ⇒ no schedule: the plan is history the moment the record exists, and `published_at`
    // is the record. Leaving the columns set would render a chip labelled with an abandoned time.
    await this.transition(id, ['approved'], {
      status: 'published', linkedinUrl: input.linkedinUrl, publishedAt: input.publishedAt ?? new Date(),
      scheduledDate: null, scheduledTime: null,
    });
  }

  async markMeasured(id: number): Promise<void> {
    const post = await this.get(id);
    if (post.status === 'measured') return;
    await this.transition(id, ['published'], { status: 'measured' });
  }

  async restoreRevision(id: number, revisionId: number): Promise<void> {
    const [rev] = await this.db.select().from(postRevisions)
      .where(and(eq(postRevisions.id, revisionId), eq(postRevisions.postId, id)));
    if (!rev) throw new NotFoundException(`revision ${revisionId} not found on post ${id}`);
    await this.updateBody(id, {
      // A Revision written by a sources-only save on a never-drafted post has body '', and
      // restoring it must not blank a body that exists since then.
      ...(rev.body ? { body: rev.body } : {}),
      // Null means the snapshot predates the column: there is nothing to restore to, so the
      // post keeps the Sources it has and the new Revision snapshots those.
      ...(rev.sources ? { sources: rev.sources } : {}),
      source: 'manual_edit',
    });
  }

  /**
   * A post and everything it owns, in one transaction under the post's row lock. The database
   * cascades what the post owns and nulls what only records it; this method does what the schema
   * cannot say: the two gates, the embeddings purge and the idea's return to the backlog.
   */
  async remove(id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      // FOR UPDATE: the gates and the delete share one lock, the same shape updateBody takes. A
      // beginDrafting UPDATE or a runs.start insert that OVERLAPS this transaction blocks on it and
      // then fails, so no orphan run row is possible. It does not close the launch window: see the
      // note below the block.
      const [post] = await tx.select().from(posts).where(eq(posts.id, id)).for('update');
      if (!post) throw new NotFoundException(`post ${id} not found`);
      if (post.status === 'measured') throw new ConflictException('post is measured; its record is final');
      const [running] = await tx.select({ id: runs.id }).from(runs)
        .where(and(eq(runs.postId, id), eq(runs.status, 'running'))).limit(1);
      if (running) throw new ConflictException(`post ${id} has run ${running.id} in flight`);
      // Inside the transaction, not after: a crash after commit would leave a vector that keeps
      // putting this post's text into prompts.
      await this.embeddings.removeFor('post', id, tx);
      // Two typed updates rather than a CASE cast onto the enum: the idea goes back to the status
      // promote accepts, triaged when it carries a tier and new otherwise. The second predicate is
      // "still points at this post" and nothing about the tier, on purpose: IdeasService.patch can
      // set a tier on a promoted idea without touching the post, so an idea with no tier at the
      // first update can have one by the second. A tier predicate here would let it slip both, and
      // the FK would then clear its pointer and leave it promoted, which promote refuses.
      await tx.update(ideas).set({ promotedPostId: null, status: 'triaged' })
        .where(and(eq(ideas.promotedPostId, id), isNotNull(ideas.suggestedTier)));
      await tx.update(ideas).set({ promotedPostId: null, status: 'new' })
        .where(eq(ideas.promotedPostId, id));
      await tx.delete(posts).where(eq(posts.id, id));
    });
    // Two races stay open, both accepted in ADR 0018. A draft launch between beginDrafting and its
    // run insert passes both gates and then fails its foreign key. An embedding written after its
    // own transaction can land after this purge; retrieval does not join posts, so it is served.

    // Rows first, directories after commit: an orphan directory nobody can reach is the cheaper
    // failure, because post ids are never reused. Neither removal ever fails the request.
    try {
      await removePostInputs(id);
    } catch (err) {
      this.log.warn(`post ${id} deleted, but its inputs directory was not removed: ${String(err)}`);
    }
    try {
      await removePostAssets(id);
    } catch (err) {
      this.log.warn(`post ${id} deleted, but its assets directory was not removed: ${String(err)}`);
    }
  }

  async setReference(postId: number, assetId: number | null): Promise<PostRow> {
    await this.get(postId); // 404 if the post is missing
    if (assetId !== null) {
      const [asset] = await this.db.select().from(assets).where(eq(assets.id, assetId));
      if (!asset) throw new UnprocessableEntityException(`asset ${assetId} not found`);
      if (asset.lane !== 'hybrid') throw new UnprocessableEntityException(`asset ${assetId} is lane '${asset.lane}' — only hybrid candidates carry a bg.png reference`);
      if (!asset.pngPath || !(await readPngSize(bgPathFor(asset.pngPath)))) {
        throw new UnprocessableEntityException(`asset ${assetId} has no readable bg.png next to its composite`);
      }
    }
    const [row] = await this.db.update(posts)
      .set({ referenceAssetId: assetId, updatedAt: new Date() })
      .where(eq(posts.id, postId)).returning();
    return row!;
  }

  async referenceCandidates(postId: number): Promise<{ assetId: number; postId: number; isSelected: boolean }[]> {
    const rows = await this.db.select({ assetId: assets.id, postId: assets.postId, isSelected: assets.isSelected })
      .from(assets).where(eq(assets.lane, 'hybrid')).orderBy(desc(assets.id));
    return rows.filter((r) => r.postId === postId || r.isSelected);
  }

  private async transition(id: number, fromStatuses: PostStatus[], set: Partial<typeof posts.$inferInsert>): Promise<void> {
    const updated = await this.db.update(posts)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(posts.id, id), inArray(posts.status, fromStatuses)))
      .returning({ id: posts.id });
    if (updated.length === 0) {
      await this.get(id);
      throw new ConflictException(`post ${id} is not in ${fromStatuses.join('|')}`);
    }
  }
}
