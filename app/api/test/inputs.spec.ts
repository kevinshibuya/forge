import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { INPUT_CAPS, REFUSAL } from '@forge/shared';
import { migrateDb } from '../src/db/migrate';
import { createDb, type ForgeDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { InputsModule } from '../src/inputs/inputs.module';
import { configureApp } from '../src/app.setup';
import { postInputs, posts } from '../src/db/schema';
import { insertMeasured } from './helpers/measured';
import { PostsService } from '../src/posts/posts.service';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

/** The plan names post #5, which is the sacrificial record on the LIVE database. The test
 *  database carries no such row, so the spec mints its own and keeps the same discipline:
 *  one post that every case is free to attach to and strip again. */
let SACRIFICIAL: number;

let app: NestExpressApplication;
let db: ForgeDb;

const http = () => request(app.getHttpServer());

beforeAll(async () => {
  await migrateDb(url);
  process.env.DATABASE_URL = url;
  db = createDb(url);

  const moduleRef = await Test.createTestingModule({ imports: [DbModule, InputsModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  const [sacrificial] = await db.insert(posts).values({
    tier: 'T3', status: 'draft_ready', hook: 'sacrificial post for the inputs spec',
    bodyLinkedin: 'a body the spec never reads',
  }).returning();
  SACRIFICIAL = sacrificial!.id;
});

afterAll(async () => {
  // forge_test is shared and post_inputs has a foreign key to posts: a row left here would block
  // every later spec that wipes the posts table.
  await db.delete(postInputs);
  await app?.close();
});

beforeEach(async () => {
  await db.delete(postInputs).where(eq(postInputs.postId, SACRIFICIAL));
});

describe('inputs preview', () => {
  it('refuses a path on this machine: 200 with the sentence at preview, 422 with it at attach', async () => {
    const preview = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`).send({ text: '~/.claude' });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({ ok: false, refused: REFUSAL.pathRetired });

    const attach = await http().post(`/api/posts/${SACRIFICIAL}/inputs`).send({ text: '~/.claude' });
    expect(attach.status).toBe(422);
    expect(attach.body.message).toBe(REFUSAL.pathRetired);
    expect((await http().get(`/api/posts/${SACRIFICIAL}/inputs`)).body).toHaveLength(0);
  });

  it('refuses a link to the operator own loopback api', async () => {
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`).send({ text: 'http://127.0.0.1:3001/' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, refused: REFUSAL.privateAddress('127.0.0.1') });
  });

  it('previews a dropped markdown file as a one-file manifest', async () => {
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`)
      .attach('file', Buffer.from('# notes\n'), 'notes.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true, kind: 'file', ref: 'notes.md',
      manifest: { files: [{ path: 'notes.md', bytes: 8 }], bytes: 8, skipped: 0, refused: [] },
    });
  });

  it('refuses a dropped binary', async () => {
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`)
      .attach('file', Buffer.from('\x89PNG'), 'photo.png');
    expect(res.body).toEqual({ ok: false, refused: REFUSAL.notText('photo.png') });
  });

  it('cannot be given a file name that climbs, whatever the client sends', async () => {
    // Deviation from the plan, which expected a 400 from the controller guard. Hand-built raw
    // multipart, because supertest normalises a filename: multer 2.0.2 basenames it first, so the
    // guard is unreachable over http and is kept only as defence in depth. What the api promises
    // is this: the name that reaches the producer carries no separator.
    const boundary = '----forgeInputsTest';
    const body = Buffer.from(
      `--${boundary}\r\n`
      + 'content-disposition: form-data; name="file"; filename="../../../x.md"\r\n'
      + 'content-type: text/markdown\r\n\r\n'
      + 'x\r\n'
      + `--${boundary}--\r\n`,
    );
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`)
      .set('content-type', `multipart/form-data; boundary=${boundary}`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ref).toBe('x.md');
    expect(res.body.manifest.files[0].path).toBe('x.md');
  });

});

describe('inputs body limits', () => {
  it('turns an upload over the cap into a 413 at the edge, before any producer runs', async () => {
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`)
      .attach('file', Buffer.alloc(INPUT_CAPS.bytes + 1, 'a'), 'big.md');
    expect(res.status).toBe(413);
  });

  it('refuses a json body past the parser limit with a 413', async () => {
    // Deviation from the plan, which said 5.5 MB. INPUT_JSON_LIMIT is 12mb, sized above twice the
    // cap so JSON escaping can never refuse a legitimate paste, so it takes 13 MB to cross it.
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`)
      .send({ text: 'a'.repeat(13 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it('lets a quote-heavy text at the cap through to the producer, not to a 413', async () => {
    // Every character escapes to two bytes, so this doubles on the wire. At the old 6mb limit the
    // transport refused it before the producer could judge it by sentence.
    const quoteHeavy = '"'.repeat(INPUT_CAPS.bytes - 1);
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`).send({ text: quoteHeavy });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('answers a text over the input cap but under the parser limit with a refusal, not a 413', async () => {
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`)
      .send({ text: 'a'.repeat(INPUT_CAPS.bytes + 1) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, refused: REFUSAL.overBytes(INPUT_CAPS.bytes + 1) });
  });

  it('previews a text comfortably under the cap', async () => {
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`)
      .send({ text: `a paste\n${'b'.repeat(4 * 1024 * 1024)}` });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ref).toBe('a paste');
  });
});

describe('inputs attach, list and remove', () => {
  it('attaches a dropped file and writes its copy under the inputs root', async () => {
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs`)
      .attach('file', Buffer.from('# notes\n'), 'notes.md');
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('file');

    const stored = path.join(process.env.INPUTS_ROOT!, String(SACRIFICIAL), String(res.body.id), 'notes.md');
    expect(existsSync(stored)).toBe(true);
    expect(await readFile(stored, 'utf8')).toBe('# notes\n');
  });

  it('flattens a pasted first line that tries to climb, and keeps the file under the root', async () => {
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs`)
      .send({ text: '../../../escape\nthe body of the paste' });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('../../../escape');

    const root = process.env.INPUTS_ROOT!;
    const folder = path.join(root, String(SACRIFICIAL), String(res.body.id));
    const [name] = await (await import('node:fs/promises')).readdir(folder);
    expect(name).not.toContain('/');
    expect(path.resolve(folder, name!).startsWith(path.resolve(root))).toBe(true);
  });

  it('refuses a second input with the same ref', async () => {
    await http().post(`/api/posts/${SACRIFICIAL}/inputs`).attach('file', Buffer.from('a'), 'dup.md');
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs`).attach('file', Buffer.from('b'), 'dup.md');
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(REFUSAL.duplicate('dup.md'));
  });

  it('numbers a second identical paste rather than colliding with it', async () => {
    await http().post(`/api/posts/${SACRIFICIAL}/inputs`).send({ text: 'a note\nbody' });
    const res = await http().post(`/api/posts/${SACRIFICIAL}/inputs`).send({ text: 'a note\nbody' });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('a note 2');
  });

  it('lists what is attached and removes a row with its folder', async () => {
    const attached = await http().post(`/api/posts/${SACRIFICIAL}/inputs`).attach('file', Buffer.from('x'), 'gone.md');
    const listed = await http().get(`/api/posts/${SACRIFICIAL}/inputs`);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);

    const folder = path.join(process.env.INPUTS_ROOT!, String(SACRIFICIAL), String(attached.body.id));
    expect(existsSync(folder)).toBe(true);

    const removed = await http().delete(`/api/posts/${SACRIFICIAL}/inputs/${attached.body.id}`);
    expect(removed.status).toBe(200);
    expect(existsSync(folder)).toBe(false);
    expect((await http().get(`/api/posts/${SACRIFICIAL}/inputs`)).body).toHaveLength(0);
  });

  it('refuses both halves of a submission, and neither', async () => {
    const neither = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`).send({});
    expect(neither.status).toBe(400);
    const both = await http().post(`/api/posts/${SACRIFICIAL}/inputs/preview`)
      .field('text', 'some text').attach('file', Buffer.from('x'), 'a.md');
    expect(both.status).toBe(400);
  });
});

describe('the measured gate on inputs', () => {
  it('refuses an attach on a measured post', async () => {
    const postsService = app.get(PostsService);
    const [post] = await db.insert(posts).values({
      tier: 'T3', status: 'published', hook: 'throwaway for the inputs measured gate',
      bodyLinkedin: 'a body the spec never reads',
    }).returning();
    await insertMeasured(db, postsService, {
      postId: post!.id, impressions: 10, reactions: 1, comments: 0, reposts: 0, saves: 0,
    });

    const res = await http().post(`/api/posts/${post!.id}/inputs`).attach('file', Buffer.from('x'), 'late.md');
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('post is measured; its inputs are final');
  });
});
