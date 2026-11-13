import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderPrompt } from '@forge/shared';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { RunnerModule } from '../src/runner/runner.module';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { ImagesModule } from '../src/images/images.module';
import { ImagesService } from '../src/images/images.service';
import { ImageComposeService, extractHtml, substituteBackground, assembleImageHtmlPrompt } from '../src/images/image-compose.service';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { RENDERER } from '../src/images/render.service';
import { FakeRenderer } from '../src/images/render.fake';
import * as store from '../src/images/asset-store';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

async function build(claude = new FakeEngine({ image_html: '```html\n<!doctype html><html><body>hi</body></html>\n```' })) {
  const mod = await Test.createTestingModule({
    imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, PostsModule, ImagesModule],
  })
    .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
    .overrideProvider(RENDERER).useValue(new FakeRenderer())
    .overrideProvider(ENGINES).useValue({ claude, codex: new FakeEngine({}) })
    .compile();
  return { compose: mod.get(ImageComposeService), images: mod.get(ImagesService), posts: mod.get(PostsService), runs: mod.get(RunsService) };
}

function pngsUnder(dir: string): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...pngsUnder(p));
    else if (e.endsWith('.png')) out.push(p);
  }
  return out;
}

describe('extractHtml (regression: image_html returns fenced HTML, not fragile JSON)', () => {
  it('extracts the document from a ```html fenced block', () => {
    const out = '```html\n<!doctype html><html><body>hi</body></html>\n```';
    expect(extractHtml(out)).toBe('<!doctype html><html><body>hi</body></html>');
  });

  it('extracts a raw <!doctype…</html> document with no fence', () => {
    const out = '<!doctype html><html><body>raw</body></html>';
    expect(extractHtml(out)).toBe(out);
  });

  it('tolerates surrounding prose + a fence + inner CSS with braces, quotes and newlines', () => {
    const out =
      'Here you go:\n```html\n<!doctype html><html><head><style>body{margin:0;font-family:"Plus Jakarta Sans"}\n.grid{color:#111}</style></head><body>x</body></html>\n```\nEnjoy!';
    const html = extractHtml(out);
    expect(html.startsWith('<!doctype html')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
    expect(html).toContain('font-family:"Plus Jakarta Sans"');
    expect(html).toContain('.grid{color:#111}');
  });

  it('throws when the output contains no HTML document', () => {
    expect(() => extractHtml('sorry, I could not generate that image')).toThrow(/no HTML document/);
  });

  it('falls back to the full output when the first fence has no document (doc in the second fence)', () => {
    const out = 'notes:\n```\njust planning\n```\n```html\n<!doctype html><html><body>x</body></html>\n```';
    const html = extractHtml(out);
    expect(html.startsWith('<!doctype html')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
  });

  it('falls back to the full output when the first fence has no document (raw doc + trailing inline code span)', () => {
    const out = '<!doctype html><html><body>x</body></html>\nTweak the ```css``` later.';
    const html = extractHtml(out);
    expect(html.startsWith('<!doctype html')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
  });
});

describe('HTML lane', () => {
  beforeAll(async () => { await migrateDb(dbUrl); process.env.DATABASE_URL = dbUrl; });

  // Fix C: if the DB insert throws after the PNG is written, the orphan file must be removed.
  it('unlinks the just-written PNG when the candidate insert fails (no orphan on disk)', async () => {
    const { compose, images, posts } = await build();
    const post = await posts.create({ tier: 'T1' });
    vi.spyOn(images, 'create').mockRejectedValueOnce(new Error('insert boom'));

    const launch = await compose.launchHtml(post.id, 'a schematic');
    await launch.finished; // finalize throws internally -> run failed, no row persisted

    expect(await images.listForPost(post.id)).toHaveLength(0);
    expect(pngsUnder(join(store.assetsRoot(), String(post.id)))).toHaveLength(0);
  });

  it('launches image_html, renders, and persists an html candidate', async () => {
    const { compose, images, posts } = await build();
    const post = await posts.create({ tier: 'T1' });
    const launch = await compose.launchHtml(post.id, 'a 1200x1200 schematic of the ladder');
    expect(launch.runId).toBeGreaterThan(0);
    await launch.finished;
    const list = await images.listForPost(post.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.lane).toBe('html');
    expect(list[0]!.htmlSource).toContain('hi');
    expect(list[0]!.pngPath).toBeTruthy();
    expect(list[0]!.width).toBe(1200);
  });
});

describe('hybrid lane, the plan step under the output contract', () => {
  beforeAll(async () => { await migrateDb(dbUrl); process.env.DATABASE_URL = dbUrl; });

  it('a declined plan fails the managed run as declined, with the envelope persisted', async () => {
    const decline = { outcome: 'declined', reason: 'the brief names no subject', question: 'what is the image about?' };
    const { compose, images, posts, runs } = await build(new FakeEngine({ image_plan: JSON.stringify({ result: decline }) }));
    const post = await posts.create({ tier: 'T1' });
    const launch = await compose.launchHybrid(post.id, 'a brief with nothing in it');
    await launch.finished;

    const run = await runs.get(launch.runId);
    expect(run.status).toBe('failed');
    expect(run.failureKind).toBe('declined');
    expect(run.error).toBe('the brief names no subject');
    expect(run.declined).toEqual(decline);
    expect(await images.listForPost(post.id)).toHaveLength(0);
  });
});

describe('substituteBackground', () => {
  it('replaces every placeholder with the data URI', () => {
    const out = substituteBackground("<div style=\"background:url('__HYBRID_BG__')\">__HYBRID_BG__</div>", 'data:image/png;base64,AAA');
    expect(out).not.toContain('__HYBRID_BG__');
    expect(out.match(/data:image\/png;base64,AAA/g)).toHaveLength(2);
  });
  it('throws when the placeholder is absent', () => {
    expect(() => substituteBackground('<div>no token</div>', 'data:image/png;base64,AAA')).toThrow();
  });
});
describe('assembleImageHtmlPrompt backgroundToken', () => {
  it('instructs the literal token + cover, embeds NO data uri', () => {
    const p = renderPrompt(assembleImageHtmlPrompt({ designLanguageDoc: 'D', brief: 'B', width: 1200, height: 1200, backgroundToken: '__HYBRID_BG__' }));
    expect(p).toContain('__HYBRID_BG__'); expect(p).toContain('cover'); expect(p).not.toContain('data:image');
  });
});
