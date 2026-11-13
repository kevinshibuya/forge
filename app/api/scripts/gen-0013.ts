/**
 * Generates src/db/migrations/0013_unslop_doc_closing_section.sql from seed-content.ts.
 *
 *   npx tsx scripts/gen-0013.ts
 *
 * Repairs a live `unslop` style doc whose body was seeded before appendix A's closing
 * `## before answering` section was restored. 0012 cannot do this: its style-doc statement is
 * guarded on the doc's absence, so it is a no-op once the doc exists, and drizzle has it
 * journalled as applied.
 *
 * The update is guarded on the stored body matching LEGACY_UNSLOP_BODY byte for byte, so an
 * operator who edited the doc in Settings keeps their version. Re-running it is a no-op.
 */
import { writeFile } from 'node:fs/promises';
import { LEGACY_UNSLOP_BODY, STYLE_DOCS } from '../src/seed/seed-content';

import { access } from 'node:fs/promises';

/** An applied migration is never edited (invariant 9). Regenerating over a committed file is how
 *  that gets violated by accident, so this refuses unless asked twice. Pass --force to diff a
 *  regeneration against the committed SQL. */
async function refuseIfCommitted(out: string): Promise<void> {
  if (process.argv.includes('--force')) return;
  const exists = await access(out).then(() => true, () => false);
  if (!exists) return;
  console.error(`${out} already exists and may be applied. Re-run with --force to overwrite.`);
  process.exit(1);
}

const OUT = 'src/db/migrations/0013_unslop_doc_closing_section.sql';
const TAG = 'fq';

function dq(text: string): string {
  const close = `$${TAG}$`;
  if (text.includes(close)) throw new Error(`text contains the dollar-quote tag ${close}`);
  return `${close}${text}${close}`;
}

async function main(): Promise<void> {
  await refuseIfCommitted(OUT);
  const doc = STYLE_DOCS[0];
  if (!doc || doc.id !== 'unslop') throw new Error('STYLE_DOCS[0] is not the unslop doc');
  if (!doc.body.includes('## before answering')) throw new Error('the new body is still missing the closing section');

  const sql = [
    '-- Restore appendix A\'s closing section on a stored unslop doc that predates it.',
    '-- Guarded on the element\'s id AND on the body matching the old seed byte for byte, so an',
    '-- operator edit is never clobbered. Idempotent: a repaired row no longer matches.',
    'UPDATE "settings" AS s',
    `   SET "data" = jsonb_set(s."data", ARRAY['styleDocs', (d.idx - 1)::text, 'body'], to_jsonb(${dq(doc.body)}::text))`,
    '  FROM (',
    '    SELECT ordinality AS idx',
    '      FROM "settings",',
    `           jsonb_array_elements("data"->'styleDocs') WITH ORDINALITY AS e(doc, ordinality)`,
    '     WHERE "id" = 1',
    `       AND e.doc->>'id' = 'unslop'`,
    `       AND e.doc->>'body' = ${dq(LEGACY_UNSLOP_BODY)}`,
    '     LIMIT 1',
    '  ) AS d',
    ' WHERE s."id" = 1;',
  ].join('\n');

  await writeFile(OUT, `${sql}\n`, 'utf8');
  console.log(`wrote ${OUT}: body ${doc.body.length} chars, legacy ${LEGACY_UNSLOP_BODY.length} chars`);
}

void main();
