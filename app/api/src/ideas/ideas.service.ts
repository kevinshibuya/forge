import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { TriageOutputSchema, type Decline, type FailureKind, type IdeaSource, type IdeaStatus, type PostTier } from '@forge/shared';
import { DB, ForgeDb } from '../db/client';
import { ideas, posts } from '../db/schema';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { PostsService } from '../posts/posts.service';
import { RunnerService } from '../runner/runner.service';
import { assembleConstitution } from '../retrieval/constitution';
import { SettingsService } from '../settings/settings.service';
import { assembleTriagePrompt } from './triage-prompt';

export type IdeaRow = typeof ideas.$inferSelect;

export type TriageResult =
  | { ok: true; idea: IdeaRow; runId: number }
  /** `declined` is set when the engine declined the triage; the controller passes it through. */
  | { ok: false; runId: number; failureKind: FailureKind; error: string; declined?: Decline };

@Injectable()
export class IdeasService {
  constructor(
    @Inject(DB) private readonly db: ForgeDb,
    private readonly embeddings: EmbeddingsService,
    private readonly posts: PostsService,
    private readonly runner: RunnerService,
    private readonly settings: SettingsService,
  ) {}

  async create(input: { rawText: string; source: IdeaSource }): Promise<IdeaRow> {
    const [row] = await this.db.insert(ideas).values(input).returning();
    await this.embeddings.upsertFor('idea', row!.id, row!.rawText);
    return row!;
  }

  async get(id: number): Promise<IdeaRow> {
    const [row] = await this.db.select().from(ideas).where(eq(ideas.id, id));
    if (!row) throw new NotFoundException(`idea ${id} not found`);
    return row;
  }

  async list(filter: { status?: IdeaStatus[]; promotedPostId?: number } = {}): Promise<IdeaRow[]> {
    const conds = [];
    if (filter.status && filter.status.length > 0) conds.push(inArray(ideas.status, filter.status));
    if (filter.promotedPostId !== undefined) conds.push(eq(ideas.promotedPostId, filter.promotedPostId));
    return this.db.select().from(ideas)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(ideas.createdAt));
  }

  async patch(id: number, patch: {
    rawText?: string; notes?: string; suggestedTier?: PostTier;
    newsExpiry?: Date | null; status?: 'new' | 'discarded';
  }): Promise<IdeaRow> {
    const idea = await this.get(id);
    // On a measured post nothing is editable, and the idea it became is part of that post's
    // record. Checked before the status guard, so the sentence names the real reason.
    if (idea.promotedPostId !== null) {
      const [post] = await this.db.select({ status: posts.status })
        .from(posts).where(eq(posts.id, idea.promotedPostId));
      if (post?.status === 'measured') throw new ConflictException('the post this idea became is measured');
    }
    if (idea.status === 'promoted' && patch.status !== undefined) {
      throw new ConflictException("a promoted idea's status is frozen");
    }
    const [row] = await this.db.update(ideas).set(patch).where(eq(ideas.id, id)).returning();
    if (!row) throw new NotFoundException(`idea ${id} not found`);
    if (patch.rawText !== undefined) await this.embeddings.upsertFor('idea', id, row.rawText);
    return row;
  }

  async triage(id: number): Promise<TriageResult> {
    const idea = await this.get(id);
    if (idea.status === 'promoted' || idea.status === 'discarded') {
      throw new ConflictException(`idea ${id} is ${idea.status}; triage only applies to new/triaged ideas`);
    }
    const constitution = assembleConstitution({ kind: 'triage', settings: await this.settings.get(), rules: [] });
    const res = await this.runner.execute({
      kind: 'triage', ...assembleTriagePrompt(constitution, idea.rawText), schema: TriageOutputSchema,
      tellFields: ['notes'],
    });
    if (!res.ok) return { ok: false, runId: res.runId, failureKind: res.failureKind, error: res.error, declined: res.declined };

    const newsExpiry = res.data.news_expiry_days == null
      ? null
      : new Date(Date.now() + res.data.news_expiry_days * 86_400_000);
    const [updated] = await this.db.update(ideas).set({
      status: 'triaged',
      source: res.data.source,
      suggestedTier: res.data.suggested_tier,
      newsExpiry,
      notes: res.data.notes,
    }).where(eq(ideas.id, id)).returning();
    return { ok: true, idea: updated!, runId: res.runId };
  }

  async promote(id: number, input: { tier: PostTier }): Promise<{ postId: number; idea: IdeaRow }> {
    const idea = await this.get(id);
    if (idea.status !== 'new' && idea.status !== 'triaged') {
      throw new ConflictException(`idea ${id} is ${idea.status}; only new/triaged ideas can be promoted`);
    }
    const post = await this.posts.create({ tier: input.tier });
    const [updated] = await this.db.update(ideas)
      .set({ status: 'promoted', promotedPostId: post.id })
      .where(and(eq(ideas.id, id), inArray(ideas.status, ['new', 'triaged'])))
      .returning();
    if (!updated) throw new ConflictException(`idea ${id} changed state during promote`);
    return { postId: post.id, idea: updated };
  }
}
