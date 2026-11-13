/**
 * One-off: give every post the Sources its latest succeeded draft run already claimed.
 *
 * Older runs store the engine's raw text with a fenced JSON block; plan A's store a bare JSON
 * string. Both go through the shared `extractJson` and the draft schema. One bad row never aborts
 * the pass: it prints and the walk goes on.
 *
 * No Revision is written. The backfill records what the post already showed on screen, so it is
 * not an edit, and a post whose column is already non-empty is left alone.
 *
 * Run from app/api: `npx tsx scripts/backfill-post-sources.ts [--yes]`. Without --yes it computes
 * and prints every line and writes nothing, which is the dry run the gate reads before the write.
 */
import postgres from 'postgres';
import { DraftOutputSchema, extractJson, type Source } from '@forge/shared';
import { loadEnv } from '../src/env';

export type BackfillLine =
  | { postId: number; outcome: 'set'; count: number; runId: number }
  | { postId: number; outcome: 'skipped_non_empty' }
  | { postId: number; outcome: 'skipped_no_run' }
  | { postId: number; outcome: 'skipped_empty_list'; runId: number }
  | { postId: number; outcome: 'skipped_unparseable'; runId: number; reason: string };

/**
 * Guarded write: the WHERE clause repeats the empty-column condition, so a column filled between
 * the read and the write is never overwritten. True when a row actually changed.
 */
export async function writeIfEmpty(sql: postgres.Sql, postId: number, list: Source[]): Promise<boolean> {
  const rows = await sql`
    UPDATE posts SET sources = ${sql.json(list)}::jsonb
    WHERE id = ${postId} AND sources = '[]'::jsonb
    RETURNING id`;
  return rows.length > 0;
}

export async function backfillPostSources(
  url: string,
  opts: { write: boolean; onLine?: (line: BackfillLine) => void },
): Promise<BackfillLine[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const lines: BackfillLine[] = [];
  // Reported as it happens, not collected and printed at the end: a write that throws halfway
  // through would otherwise take every line already decided down with it.
  const record = (line: BackfillLine) => { lines.push(line); opts.onLine?.(line); };
  try {
    const postRows = await sql<{ id: number; empty: boolean }[]>`
      SELECT id, sources = '[]'::jsonb AS empty FROM posts ORDER BY id`;
    for (const post of postRows) {
      if (!post.empty) { record({ postId: post.id, outcome: 'skipped_non_empty' }); continue; }
      // Declined runs are recorded as failed, so this never picks one up.
      const [run] = await sql<{ id: number; output: string | null }[]>`
        SELECT id, output FROM runs
        WHERE post_id = ${post.id} AND kind = 'draft' AND status = 'succeeded'
        ORDER BY started_at DESC, id DESC LIMIT 1`;
      if (!run) { record({ postId: post.id, outcome: 'skipped_no_run' }); continue; }

      let list: Source[];
      try {
        list = DraftOutputSchema.parse(extractJson(run.output ?? '')).sources ?? [];
      } catch (err) {
        record({ postId: post.id, outcome: 'skipped_unparseable', runId: run.id, reason: String(err) });
        continue;
      }
      // An empty parsed list changes nothing, so calling it `set` would let a rerun claim writes
      // it never made.
      if (list.length === 0) { record({ postId: post.id, outcome: 'skipped_empty_list', runId: run.id }); continue; }

      if (!opts.write) { record({ postId: post.id, outcome: 'set', count: list.length, runId: run.id }); continue; }
      const wrote = await writeIfEmpty(sql, post.id, list);
      record(wrote
        ? { postId: post.id, outcome: 'set', count: list.length, runId: run.id }
        : { postId: post.id, outcome: 'skipped_non_empty' });
    }
  } finally {
    await sql.end();
  }
  return lines;
}

function describe(line: BackfillLine): string {
  switch (line.outcome) {
    case 'set': return `set ${line.count} from run ${line.runId}`;
    case 'skipped_non_empty': return 'skipped, sources already set';
    case 'skipped_no_run': return 'skipped, no succeeded draft run';
    case 'skipped_empty_list': return `skipped, run ${line.runId} cited nothing`;
    case 'skipped_unparseable': return `skipped, run ${line.runId} output unparseable: ${line.reason}`;
  }
}

const invokedDirectly = process.argv[1]?.endsWith('backfill-post-sources.ts');
if (invokedDirectly) {
  loadEnv();
  const url = process.env.DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge';
  const write = process.argv.includes('--yes');
  backfillPostSources(url, { write, onLine: (l) => console.log(`post ${l.postId}: ${describe(l)}`) })
    .then((lines) => {
      const set = lines.filter((l) => l.outcome === 'set').length;
      console.log(write
        ? `${set} of ${lines.length} posts written`
        : `dry run: ${set} of ${lines.length} posts would be written. re-run with --yes to write.`);
    })
    .catch((err: unknown) => {
      console.error('backfill failed:', err);
      process.exitCode = 1;
    });
}
