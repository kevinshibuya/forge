import { renderPrompt } from '@forge/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { RunsModule } from '../src/runs/runs.module';
import { RunnerModule } from '../src/runner/runner.module';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { RunsService } from '../src/runs/runs.service';
import { RunnerService } from '../src/runner/runner.service';
import { ImagesModule } from '../src/images/images.module';
import { ImagesService } from '../src/images/images.service';
import { ImageComposeService } from '../src/images/image-compose.service';
import { bgPathFor, candidateDir, newGroupId, writePng } from '../src/images/asset-store';
import { ENGINES } from '../src/engines/engine.interface';
import { structuredFrom } from '../src/engines/fake.engine';
import type { Engine, EngineRequest, EngineResult, EngineEvent } from '../src/engines/engine.interface';
import { RENDERER } from '../src/images/render.service';
import { FakeRenderer } from '../src/images/render.fake';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

// A 1200×1200 PNG header. readPngSize only inspects the 24-byte signature + IHDR, so this is
// sufficient for the background dimension check without encoding a full image.
function png1200(): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(1200, 16);
  b.writeUInt32BE(1200, 20);
  return b;
}

// codex slot: writes bg.png into the run's cwd (like the real image_gen tool) then returns ok.
class BgWritingEngine implements Engine {
  readonly name = 'fake' as const;
  readonly requests: EngineRequest[] = [];
  async run(req: EngineRequest): Promise<EngineResult> {
    this.requests.push(req);
    if (req.cwd) await writeFile(join(req.cwd, 'bg.png'), png1200());
    return { output: 'bg written' };
  }
}

// claude slot: queue canned responses per kind, capturing each prompt for assertions. The last
// entry repeats so any loop that calls a kind again keeps terminating.
class QueueClaude implements Engine {
  readonly name = 'fake' as const;
  readonly prompts: Record<string, string[]> = {};
  readonly requests: EngineRequest[] = [];
  constructor(private readonly queues: Partial<Record<EngineRequest['kind'], string[]>>) {}
  async run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult> {
    this.requests.push(req);
    (this.prompts[req.kind] ??= []).push(renderPrompt(req));
    const q = this.queues[req.kind];
    const output = q && q.length > 0 ? (q.length > 1 ? q.shift()! : q[0]!) : `fake:${req.kind}`;
    onEvent?.({ type: 'chunk', data: output });
    return { output, structured: structuredFrom(output) };
  }
}

const VALID_PLAN = '```json\n{"backgroundPrompt":"deep navy gradient","headline":"The Idle Transaction","subtext":"why it flips","textZone":"lower-third","palette":"navy/teal"}\n```';
const TEXT_HTML = "```html\n<!doctype html><html><body><div style=\"background-image:url('__HYBRID_BG__');background-size:cover\"></div></body></html>\n```";

async function build(queues: Partial<Record<EngineRequest['kind'], string[]>>) {
  const claude = new QueueClaude(queues);
  const codex = new BgWritingEngine();
  const mod = await Test.createTestingModule({
    imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, PostsModule, ImagesModule],
  })
    .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
    .overrideProvider(RENDERER).useValue(new FakeRenderer())
    .overrideProvider(ENGINES).useValue({ claude, codex })
    .compile();
  return {
    compose: mod.get(ImageComposeService), images: mod.get(ImagesService),
    posts: mod.get(PostsService), runs: mod.get(RunsService), runner: mod.get(RunnerService), claude, codex,
  };
}

const LEVERAGE_PLAN = '```json\n{"backgroundPrompt":"deep navy gradient","headline":"leverage the idle transaction","subtext":"why it flips","textZone":"lower-third","palette":"navy/teal"}\n```';

describe('hybrid orchestration (fake engines)', () => {
  beforeAll(async () => { await migrateDb(dbUrl); process.env.DATABASE_URL = dbUrl; });

  // The plan step runs through executeManaged's `call`, never `execute`, so it lints in the
  // compose service and rides on the parent image_hybrid run.
  it('records the plan headline tells on the parent run', async () => {
    const { compose, posts, runs } = await build({ image_plan: [LEVERAGE_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const launch = await compose.launchHybrid(post.id, 'a dash free brief');
    await launch.finished;

    const run = await runs.get(launch.runId);
    expect(run.status).toBe('succeeded');
    expect(run.tells).toEqual([
      { id: 'plain-word', label: 'fancier synonym', start: 0, end: 8, field: 'plan.headline' },
    ]);
  });

  it('records an empty tell list for a clean plan', async () => {
    const { compose, posts, runs } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const launch = await compose.launchHybrid(post.id, 'a dash free brief');
    await launch.finished;
    expect((await runs.get(launch.runId)).tells).toEqual([]);
  });

  it('orchestrates plan -> background -> text -> composite into one hybrid candidate', async () => {
    const { compose, images, posts, claude, codex } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const launch = await compose.launchHybrid(post.id, 'a post about senior hiring');
    await launch.finished;
    const hybrids = (await images.listForPost(post.id)).filter((a) => a.lane === 'hybrid');
    expect(hybrids).toHaveLength(1);
    expect(hybrids[0]!.width).toBe(1200);
    const textPrompt = claude.prompts.image_html?.[0] ?? '';
    expect(textPrompt).toContain('__HYBRID_BG__');
    expect(textPrompt).not.toContain('data:image'); // the invariant: no base64 in the text prompt
    // control: no reference set -> no image attached to the background call, no reference clause in the plan
    expect(codex.requests[0]!.images).toBeUndefined();
    expect(claude.prompts.image_plan?.[0] ?? '').not.toContain('reference image');
  });

  it('hybrid run keeps the reference extract-only: prompts aware, no image attached', async () => {
    const { compose, images, posts, claude, codex } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const refDir = candidateDir(post.id, newGroupId());
    const refPng = await writePng(refDir, 0, png1200());
    await writeFile(join(refDir, 'bg.png'), png1200());
    const refAsset = await images.create({ postId: post.id, lane: 'hybrid', pngPath: refPng, width: 1200, height: 1200, candidateGroupId: 'ref-g' });
    await posts.setReference(post.id, refAsset.id);

    const launch = await compose.launchHybrid(post.id, 'the brief');
    await launch.finished;

    const bgReq = codex.requests.find((r) => r.kind === 'image_gen')!;
    // extract-only fallback (eye-test 2026-07-22): an attached image anchors composition and
    // kills batch diversity — style flows through refLearnings text only, never `-i`.
    expect(bgReq.images).toBeUndefined();
    expect(renderPrompt(bgReq)).toContain('Style direction distilled from a previous winning image');
    const planReq = claude.requests.find((r) => r.kind === 'image_plan')!;
    expect(renderPrompt(planReq)).toContain(bgPathFor(refPng));
    // The reference rides as an image, which is what lets the cli plan step Read it.
    expect(planReq.images).toEqual([bgPathFor(refPng)]);
  });

  it('hybrid run fails loudly when the reference bg.png is gone', async () => {
    const { compose, images, posts, runs } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const refDir = candidateDir(post.id, newGroupId());
    const refPng = await writePng(refDir, 0, png1200());
    await writeFile(join(refDir, 'bg.png'), png1200());
    const refAsset = await images.create({ postId: post.id, lane: 'hybrid', pngPath: refPng, width: 1200, height: 1200, candidateGroupId: 'ref-g2' });
    await posts.setReference(post.id, refAsset.id);
    await rm(join(refDir, 'bg.png'));

    const launch = await compose.launchHybrid(post.id, 'the brief');
    await launch.finished;

    const run = await runs.get(launch.runId);
    expect(run.status).toBe('failed');
    expect(run.error ?? '').toContain('bg.png missing');
    // fail-loud: the run never produced a NEW composite candidate — only the seeded reference remains
    expect((await images.listForPost(post.id)).filter((a) => a.lane === 'hybrid')).toHaveLength(1);
  });

  it('fails (no candidate) when the plan JSON is malformed', async () => {
    const { compose, images, posts } = await build({ image_plan: ['not json at all'], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const launch = await compose.launchHybrid(post.id, 'x');
    await launch.finished;
    expect((await images.listForPost(post.id)).filter((a) => a.lane === 'hybrid')).toHaveLength(0);
  });

  it('launchHybridBatch produces N independent hybrid candidates', async () => {
    const { compose, images, posts } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const { runIds, finished } = await compose.launchHybridBatch(post.id, 'a brief', 3);
    expect(runIds).toHaveLength(3);
    await finished;
    const hybrids = (await images.listForPost(post.id)).filter((a) => a.lane === 'hybrid');
    expect(hybrids).toHaveLength(3);
    hybrids.forEach((h) => { expect(h.width).toBe(1200); expect(h.height).toBe(1200); });
  });

  it('launchHybridBatch threads the reference style direction into EVERY pipeline\'s bg call — never the image', async () => {
    // The meaningful fan-out guard: catches a regression that threads the reference into only the
    // first of N pipelines. build() exposes the BgWritingEngine (`codex`) with its captured requests.
    // Extract-only invariant: the style direction reaches every prompt; no pipeline attaches the image.
    const { compose, images, posts, codex } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const refDir = candidateDir(post.id, newGroupId());
    const refPng = await writePng(refDir, 0, png1200());
    await writeFile(join(refDir, 'bg.png'), png1200());
    const refAsset = await images.create({ postId: post.id, lane: 'hybrid', pngPath: refPng, width: 1200, height: 1200, candidateGroupId: 'ref-batch' });
    await posts.setReference(post.id, refAsset.id);

    const { finished } = await compose.launchHybridBatch(post.id, 'the brief', 3);
    await finished;

    const bgReqs = codex.requests.filter((r) => r.kind === 'image_gen');
    expect(bgReqs).toHaveLength(3);
    bgReqs.forEach((r) => {
      expect(r.images).toBeUndefined();
      expect(renderPrompt(r)).toContain('Style direction distilled from a previous winning image');
    });
  });

  it('launchHybridBatch clamps batch to 1..10', async () => {
    const { compose, posts } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const hi = await compose.launchHybridBatch(post.id, 'b', 20);
    expect(hi.runIds).toHaveLength(10);
    await hi.finished;
    const lo = await compose.launchHybridBatch(post.id, 'b', 0);
    expect(lo.runIds).toHaveLength(1);
    await lo.finished;
  });

  it('launchHybridBatch defaults to settings.imageCandidateBatch (4) when batch omitted', async () => {
    const { compose, posts } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const { runIds, finished } = await compose.launchHybridBatch(post.id, 'b');
    expect(runIds).toHaveLength(4); // app/shared/src/settings.ts:50
    await finished;
  });

  const DIRECTIONS = '```json\n{"directions":["dir alpha","dir beta","dir gamma"]}\n```';

  it('launchHybridBatch diversifies: each pipeline gets the brief plus its own direction', async () => {
    const { compose, posts, claude } = await build({
      image_variate: [DIRECTIONS], image_plan: [VALID_PLAN], image_html: [TEXT_HTML],
    });
    const post = await posts.create({ tier: 'T1' });
    const { runIds, finished } = await compose.launchHybridBatch(post.id, 'the base brief', 3);
    await finished;
    expect(runIds).toHaveLength(3);
    expect(claude.prompts.image_variate).toHaveLength(1);
    expect(claude.prompts.image_variate![0]).toContain('the base brief');
    const planPrompts = claude.prompts.image_plan!;
    expect(planPrompts).toHaveLength(3);
    for (const dir of ['dir alpha', 'dir beta', 'dir gamma']) {
      expect(planPrompts.filter((p) => p.includes(dir))).toHaveLength(1);
    }
    for (const p of planPrompts) {
      expect(p).toContain('the base brief');
      expect(p).toContain('## visual direction (this candidate)');
      expect(p).toContain('SUPERSEDES any specific visual devices');
    }
  });

  it('launchHybridBatch fail-open: unusable variator output falls back to the plain brief', async () => {
    // No image_variate queue → QueueClaude returns 'fake:image_variate' → extractJson fails →
    // the variator run records a failure and every pipeline gets the undecorated brief.
    const { compose, posts, claude, runs } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const { runIds, finished } = await compose.launchHybridBatch(post.id, 'plain brief', 2);
    await finished;
    expect(runIds).toHaveLength(2);
    for (const p of claude.prompts.image_plan!) {
      expect(p).toContain('plain brief');
      expect(p).not.toContain('## visual direction');
    }
    const rows = await runs.list({ postId: post.id });
    expect(rows.some((r) => r.kind === 'image_variate' && r.status === 'failed')).toBe(true);
  });

  it('launchHybridBatch fail-open: fewer directions than n → the missing slots get the plain brief', async () => {
    // The spec names this branch explicitly. Without a test, a later `directions.map(...)` refactor
    // would silently launch 2 pipelines for a batch of 3 and every existing test would still pass.
    const { compose, posts, claude } = await build({
      image_variate: ['```json\n{"directions":["only alpha","only beta"]}\n```'],
      image_plan: [VALID_PLAN], image_html: [TEXT_HTML],
    });
    const post = await posts.create({ tier: 'T1' });
    const { runIds, finished } = await compose.launchHybridBatch(post.id, 'short brief', 3);
    await finished;
    expect(runIds).toHaveLength(3);
    const planPrompts = claude.prompts.image_plan!;
    expect(planPrompts).toHaveLength(3);
    expect(planPrompts.filter((p) => p.includes('## visual direction'))).toHaveLength(2);
    expect(planPrompts.filter((p) => !p.includes('## visual direction'))).toHaveLength(1);
  });

  it('launchHybridBatch fail-open: a blank direction degrades to the plain brief, not an empty override', async () => {
    const { compose, posts, claude } = await build({
      image_variate: ['```json\n{"directions":["real direction","   "]}\n```'],
      image_plan: [VALID_PLAN], image_html: [TEXT_HTML],
    });
    const post = await posts.create({ tier: 'T1' });
    const { runIds, finished } = await compose.launchHybridBatch(post.id, 'blank brief', 2);
    await finished;
    expect(runIds).toHaveLength(2);
    // The whole directions payload is rejected by the schema, so BOTH slots fall back — the point is
    // that no pipeline is ever told to supersede the brief's visuals with whitespace.
    for (const p of claude.prompts.image_plan!) {
      expect(p).not.toMatch(/## visual direction \(this candidate\)\s*\n\s*\n/);
    }
  });

  it('launchHybridBatch fail-open: the batch still launches when the variator run cannot even start', async () => {
    // runner.execute does real work BEFORE its try block (settings.get, runs.start, events.open) —
    // an unmigrated DB makes runs.start reject on the image_variate enum. Pre-fix that rejection
    // propagated out of launchHybridBatch and the whole batch returned 500 with zero pipelines.
    const { compose, posts, claude, runner } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    vi.spyOn(runner, 'execute').mockRejectedValueOnce(
      new Error('invalid input value for enum run_kind: "image_variate"'),
    );
    const { runIds, finished } = await compose.launchHybridBatch(post.id, 'unmigrated brief', 3);
    await finished;
    expect(runIds).toHaveLength(3);
    for (const p of claude.prompts.image_plan!) {
      expect(p).toContain('unmigrated brief');
      expect(p).not.toContain('## visual direction');
    }
  });

  it('launchHybridBatch n=1 skips the variator entirely', async () => {
    const { compose, posts, claude } = await build({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] });
    const post = await posts.create({ tier: 'T1' });
    const { finished } = await compose.launchHybridBatch(post.id, 'solo brief', 1);
    await finished;
    expect(claude.prompts.image_variate).toBeUndefined();
  });
});
