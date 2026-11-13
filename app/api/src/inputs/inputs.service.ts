import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  INPUT_CAPS, INPUT_FILE_EXTENSIONS, INPUT_TEXT_BASENAMES, REFUSAL, inferInputKind,
  pastedTextRef, type InputKind, type InputManifest, type InputPreview,
} from '@forge/shared';
import { DB, ForgeDb } from '../db/client';
import { postInputs, type PostInputRow } from '../db/schema';
import { PostsService } from '../posts/posts.service';
import { storedName, removeStored, writeStored } from './inputs-store';
import { fetchArticle } from './url-article';
import { pdfText } from './pdf-text';

/** What arrives at the edge: a multipart file, or a text the operator typed or pasted. */
export type Submission = { file: { name: string; buffer: Buffer } } | { text: string };

/** What a producer worked out, before anything is written or stored. `text` exists for the two
 *  kinds that get a frozen copy. */
type Produced =
  | { ok: true; kind: InputKind; ref: string; manifest: InputManifest; text?: string }
  | { ok: false; refused: string };

/** A dropped file may be text-like or a pdf; the pdf becomes text at attach. */
function isDroppable(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1);
  if (INPUT_TEXT_BASENAMES.includes(base)) return true;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return INPUT_FILE_EXTENSIONS.includes(base.slice(dot + 1).toLowerCase());
}

function oneFile(kind: InputKind, ref: string, text: string): InputManifest {
  return {
    files: [{ path: storedName(kind, ref), bytes: Buffer.byteLength(text, 'utf8') }],
    bytes: Buffer.byteLength(text, 'utf8'),
    skipped: 0,
    refused: [],
  };
}

@Injectable()
export class InputsService {
  constructor(
    @Inject(DB) private readonly db: ForgeDb,
    private readonly posts: PostsService,
  ) {}

  async list(postId: number): Promise<PostInputRow[]> {
    await this.posts.get(postId);
    return this.db.select().from(postInputs).where(eq(postInputs.postId, postId)).orderBy(asc(postInputs.id));
  }

  /**
   * The one producer behind preview and attach. The server never trusts a preview the client says
   * it saw, so attach runs this again: a page may have changed in between.
   */
  private async produce(postId: number, s: Submission): Promise<Produced> {
    if ('file' in s) {
      const { name, buffer } = s.file;
      if (!isDroppable(name)) return { ok: false, refused: REFUSAL.notText(name) };

      let text: string;
      if (name.toLowerCase().endsWith('.pdf')) {
        const converted = await pdfText(buffer);
        if (!converted.ok) return converted;
        text = converted.text;
      } else {
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch {
          return { ok: false, refused: REFUSAL.notText(name) };
        }
      }
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > INPUT_CAPS.bytes) return { ok: false, refused: REFUSAL.overBytes(bytes) };
      return { ok: true, kind: 'file', ref: name, manifest: oneFile('file', name, text), text };
    }

    const kind = inferInputKind(s.text);

    if (kind === 'url') {
      const ref = s.text.trim();
      const converted = await fetchArticle(ref);
      if (!converted.ok) return converted;
      const bytes = Buffer.byteLength(converted.text, 'utf8');
      if (bytes > INPUT_CAPS.bytes) return { ok: false, refused: REFUSAL.overBytes(bytes) };
      return { ok: true, kind, ref, manifest: oneFile('url', ref, converted.text), text: converted.text };
    }

    // ADR 0017 amended: a place on this machine is no longer an Input. The kind survives only for
    // the rows attached before slice 2, which slice 12 converts.
    if (kind === 'path') return { ok: false, refused: REFUSAL.pathRetired };

    const taken = (await this.db.select({ ref: postInputs.ref }).from(postInputs)
      .where(eq(postInputs.postId, postId))).map((r) => r.ref);
    const ref = pastedTextRef(s.text, taken);
    const bytes = Buffer.byteLength(s.text, 'utf8');
    if (bytes > INPUT_CAPS.bytes) return { ok: false, refused: REFUSAL.overBytes(bytes) };
    return { ok: true, kind: 'file', ref, manifest: oneFile('file', ref, s.text), text: s.text };
  }

  /** Never throws for a refusal: the union is the answer and the status stays 200. */
  async preview(postId: number, s: Submission): Promise<InputPreview> {
    await this.posts.get(postId);
    const produced = await this.produce(postId, s);
    if (!produced.ok) return { ok: false, refused: produced.refused };
    return { ok: true, kind: produced.kind, ref: produced.ref, manifest: produced.manifest };
  }

  async attach(postId: number, s: Submission): Promise<PostInputRow> {
    const post = await this.posts.get(postId);
    if (post.status === 'measured') throw new ConflictException('post is measured; its inputs are final');

    const produced = await this.produce(postId, s);
    if (!produced.ok) throw new UnprocessableEntityException(produced.refused);

    let row: PostInputRow;
    try {
      const [inserted] = await this.db.insert(postInputs).values({
        postId, kind: produced.kind, ref: produced.ref, bytes: produced.manifest.bytes,
      }).returning();
      row = inserted!;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(REFUSAL.duplicate(produced.ref));
      }
      throw err;
    }

    if (produced.text !== undefined) {
      try {
        await writeStored(postId, row.id, produced.kind, produced.ref, produced.text);
      } catch (err) {
        // The row and its copy travel together: a half-attached input would stage as storedMissing.
        // The ROW goes first, because a folder left behind is litter while a row left behind fails
        // every later run on this post.
        await this.db.delete(postInputs).where(eq(postInputs.id, row.id));
        await removeStored(postId, row.id).catch(() => undefined);
        throw err;
      }
    }
    return row;
  }

  async remove(postId: number, inputId: number): Promise<void> {
    const post = await this.posts.get(postId);
    if (post.status === 'measured') throw new ConflictException('post is measured; its inputs are final');

    const deleted = await this.db.delete(postInputs)
      .where(and(eq(postInputs.id, inputId), eq(postInputs.postId, postId))).returning();
    if (deleted.length === 0) throw new NotFoundException(`input ${inputId} not found on post ${postId}`);
    await removeStored(postId, inputId);
  }

}
