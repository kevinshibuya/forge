import { beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
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
import { ImageGenService } from '../src/images/image-gen.service';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { CodexEngine } from '@forge/engine-cli';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
// ABSOLUTE stub path: the run's cwd is the candidate dir, so a relative script arg would resolve
// against that dir and ENOENT. resolve() is evaluated at import time (cwd = app/api).
const STUB = resolve('test/fixtures/stub-codex-images.mjs');
const SYMLINK_STUB = resolve('test/fixtures/stub-codex-symlink.mjs');

async function build(count = 3) {
  const mod = await Test.createTestingModule({
    imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, PostsModule, ImagesModule],
  })
    .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
    .overrideProvider(ENGINES).useValue({
      claude: new FakeEngine({}),
      codex: new CodexEngine(process.execPath, [STUB], { STUB_IMAGE_COUNT: String(count) }),
    })
    .compile();
  return { gen: mod.get(ImageGenService), images: mod.get(ImagesService), posts: mod.get(PostsService), runs: mod.get(RunsService) };
}

describe('Raster lane', () => {
  beforeAll(async () => { await migrateDb(dbUrl); process.env.DATABASE_URL = dbUrl; });

  it('ingests every codex-written PNG as a raster candidate', async () => {
    const { gen, images, posts, runs } = await build(3);
    const post = await posts.create({ tier: 'T1' });
    const launch = await gen.launchRaster(post.id, 'an evocative raster of an ink canvas', 3);
    await launch.finished;
    const list = await images.listForPost(post.id);
    expect(list).toHaveLength(3);
    expect(list.every((a) => a.lane === 'raster')).toBe(true);
    expect(list.every((a) => a.generationPrompt === 'an evocative raster of an ink canvas')).toBe(true);
    expect((await runs.get(launch.runId)).status).toBe('succeeded');
  });

  // Fix F: a symlink planted in the candidate dir must NOT be ingested (only regular files are).
  it('skips a symlink in the candidate dir and ingests only the regular PNG', async () => {
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, PostsModule, ImagesModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({
        claude: new FakeEngine({}),
        codex: new CodexEngine(process.execPath, [SYMLINK_STUB], {}),
      })
      .compile();
    const gen = mod.get(ImageGenService);
    const images = mod.get(ImagesService);
    const posts = mod.get(PostsService);
    const runs = mod.get(RunsService);

    const post = await posts.create({ tier: 'T1' });
    const launch = await gen.launchRaster(post.id, 'brief', 2);
    await launch.finished;

    const list = await images.listForPost(post.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.pngPath!.endsWith('0.png')).toBe(true);
    expect((await runs.get(launch.runId)).status).toBe('succeeded');
  });
});
