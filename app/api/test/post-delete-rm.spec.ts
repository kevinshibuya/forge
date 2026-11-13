import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { assetsRoot, candidateDir, writePng } from '../src/images/asset-store';

// vi.mock is hoisted above the imports, so PostsService binds to this removePostInputs. Module
// mocks are per file, which is why this case does not live in posts.spec.ts.
vi.mock('../src/inputs/inputs-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/inputs/inputs-store')>()),
  removePostInputs: vi.fn().mockRejectedValue(new Error('EACCES')),
}));

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('PostsService.remove, when a directory removal fails', () => {
  let svc: PostsService;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule] })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .compile();
    svc = mod.get(PostsService);
  });

  it('still deletes the post, logs the failure, and still removes the other directory', async () => {
    const post = await svc.create({ tier: 'T3' });
    await writePng(candidateDir(post.id, 'g'), 0, Buffer.from('a'));
    expect(existsSync(join(assetsRoot(), String(post.id)))).toBe(true);
    const warn = vi.spyOn(Logger.prototype, 'warn');

    await expect(svc.remove(post.id)).resolves.toBeUndefined();

    await expect(svc.get(post.id)).rejects.toThrow(NotFoundException);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`post ${post.id}\\b.*inputs`)));
    expect(existsSync(join(assetsRoot(), String(post.id)))).toBe(false);
  });
});
