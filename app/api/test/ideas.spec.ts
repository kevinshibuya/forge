import { beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { IdeasModule } from '../src/ideas/ideas.module';
import { IdeasService } from '../src/ideas/ideas.service';
import { ideas, posts as postsTable } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { PostsService } from '../src/posts/posts.service';
import { insertMeasured } from './helpers/measured';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

async function buildModule(triageResponse: string): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [DbModule, SettingsModule, EmbeddingsModule, IdeasModule] })
    .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
    .overrideProvider(ENGINES).useValue({
      claude: new FakeEngine({ triage: triageResponse }),
      codex: new FakeEngine({}),
    })
    .compile();
}

async function buildService(triageResponse: string): Promise<IdeasService> {
  return (await buildModule(triageResponse)).get(IdeasService);
}

describe('IdeasService', () => {
  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    await createDb(url).delete(ideas);
  });

  it('create → triage applies the suggestion and computes expiry', async () => {
    const svc = await buildService(
      '{"source":"news","suggested_tier":"T3","news_expiry_days":5,"notes":"time-pegged take"}',
    );
    const idea = await svc.create({ rawText: 'fable window closes friday', source: 'braindump' });
    expect(idea.status).toBe('new');

    const res = await svc.triage(idea.id);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.idea.status).toBe('triaged');
      expect(res.idea.source).toBe('news');
      expect(res.idea.suggestedTier).toBe('T3');
      const days = (res.idea.newsExpiry!.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(4.9);
      expect(days).toBeLessThan(5.1);
    }
  });

  it('triage failure is a value; idea stays untriaged', async () => {
    const svc = await buildService('not json at all');
    const idea = await svc.create({ rawText: 'x', source: 'work' });
    const res = await svc.triage(idea.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failureKind).toBe('invalid_output');
    expect((await svc.list({ status: ['new'] })).some((i) => i.id === idea.id)).toBe(true);
  });

  it('a declined triage carries the envelope on the result; idea stays untriaged', async () => {
    const declined = { outcome: 'declined', reason: 'the idea has no subject', question: 'what is it about?' };
    const svc = await buildService(JSON.stringify({ result: declined }));
    const idea = await svc.create({ rawText: 'x', source: 'work' });
    const res = await svc.triage(idea.id);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failureKind).toBe('declined');
      expect(res.error).toBe(declined.reason);
      expect(res.declined).toEqual(declined);
    }
    expect((await svc.list({ status: ['new'] })).some((i) => i.id === idea.id)).toBe(true);
  });

  it('promote creates the post and links both ways', async () => {
    const svc = await buildService('{}');
    const idea = await svc.create({ rawText: 'agent ladder deep dive', source: 'work' });
    const { postId, idea: updated } = await svc.promote(idea.id, { tier: 'T1' });
    expect(updated.status).toBe('promoted');
    expect(updated.promotedPostId).toBe(postId);
    await expect(svc.promote(idea.id, { tier: 'T1' })).rejects.toThrow(); // already promoted
    expect((await svc.list({ promotedPostId: postId }))[0]!.id).toBe(idea.id);
  });

  it('discard and re-embed on rawText patch', async () => {
    const svc = await buildService('{}');
    const idea = await svc.create({ rawText: 'meh', source: 'braindump' });
    await svc.patch(idea.id, { rawText: 'actually good', notes: 'reworded' });
    const discarded = await svc.patch(idea.id, { status: 'discarded' });
    expect(discarded.status).toBe('discarded');
  });

  it("a promoted idea's status is frozen; discarded ideas can be revived", async () => {
    const svc = await buildService('{}');
    const idea = await svc.create({ rawText: 'promote me', source: 'work' });
    const { idea: promoted } = await svc.promote(idea.id, { tier: 'T2' });
    expect(promoted.status).toBe('promoted');

    await expect(svc.patch(idea.id, { status: 'discarded' }))
      .rejects.toThrow("a promoted idea's status is frozen");

    const discardedIdea = await svc.create({ rawText: 'discard me', source: 'work' });
    await svc.patch(discardedIdea.id, { status: 'discarded' });
    const revived = await svc.patch(discardedIdea.id, { status: 'new' });
    expect(revived.status).toBe('new');
  });

  it("a promoted idea's text is live", async () => {
    const svc = await buildService('{}');
    const idea = await svc.create({ rawText: 'promote me too', source: 'work' });
    const { idea: promoted } = await svc.promote(idea.id, { tier: 'T2' });

    const patched = await svc.patch(idea.id, { rawText: 'sharper' });
    expect(patched.rawText).toBe('sharper');
    expect(patched.status).toBe('promoted');
    expect(patched.promotedPostId).toBe(promoted.promotedPostId);
  });

  it('the api edge trims the idea text and refuses an empty one', async () => {
    const mod = await buildModule('{}');
    const app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    try {
      const svc = mod.get(IdeasService);
      const idea = await svc.create({ rawText: 'edge case', source: 'work' });

      await request(app.getHttpServer()).patch(`/api/ideas/${idea.id}`).send({ rawText: '   ' }).expect(400);

      const ok = await request(app.getHttpServer())
        .patch(`/api/ideas/${idea.id}`).send({ rawText: '  sharper  ' }).expect(200);
      expect(ok.body.rawText).toBe('sharper');
    } finally {
      await app.close();
    }
  });

  it('refuses every field on an idea whose post is measured, and allows it before that', async () => {
    const mod = await buildModule('{}');
    const svc = mod.get(IdeasService);
    const posts = mod.get(PostsService);
    const db = createDb(url);

    const idea = await svc.create({ rawText: 'an idea that became a measured post', source: 'work' });
    const { postId } = await svc.promote(idea.id, { tier: 'T3' });

    // draft_ready first: the gate is the measured status, not the promotion.
    const edited = await svc.patch(idea.id, { notes: 'still editable' });
    expect(edited.notes).toBe('still editable');

    await db.update(postsTable).set({ status: 'published' }).where(eq(postsTable.id, postId));
    await insertMeasured(db, posts, {
      postId, impressions: 10, reactions: 1, comments: 0, reposts: 0, saves: 0,
    });

    await expect(svc.patch(idea.id, { notes: 'too late' }))
      .rejects.toThrow('the post this idea became is measured');

    const app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    try {
      const res = await request(app.getHttpServer()).patch(`/api/ideas/${idea.id}`).send({ notes: 'too late' });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('the post this idea became is measured');
    } finally {
      await app.close();
    }
  });
});
