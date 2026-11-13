/**
 * Generates src/db/migrations/0016_persona_post_shape.sql from seed-content.ts.
 *
 *   npx tsx scripts/gen-0016.ts
 *
 * Moves the two post-shape lines that ruling 7 left behind under `named exceptions`, where
 * `personaFor`'s heading slice cannot reach them: a triage or image run was still being told about
 * glyph bullets in the ONE technical block of a T1 post, and about a closing aphorism the sliced
 * persona no longer defines. 0015 is applied and is never edited, so this is its own migration.
 *
 * Guarded on the stored persona matching what 0015 wrote byte for byte. Re-running is a no-op.
 */
import { access, writeFile } from 'node:fs/promises';
import { PERSONA_DOC, PRE_0016_PERSONA_DOC } from '../src/seed/seed-content';

async function refuseIfCommitted(out: string): Promise<void> {
  if (process.argv.includes('--force')) return;
  const exists = await access(out).then(() => true, () => false);
  if (!exists) return;
  console.error(`${out} already exists and may be applied. Re-run with --force to overwrite.`);
  process.exit(1);
}

const OUT = 'src/db/migrations/0016_persona_post_shape.sql';
const TAG = 'fq';

function dq(text: string): string {
  const close = `$${TAG}$`;
  if (text.includes(close)) throw new Error(`text contains the dollar-quote tag ${close}`);
  return `${close}${text}${close}`;
}

async function main(): Promise<void> {
  await refuseIfCommitted(OUT);
  if (PERSONA_DOC === PRE_0016_PERSONA_DOC) throw new Error('persona is unchanged; nothing to migrate');

  const head = (doc: string) => doc.slice(0, doc.indexOf('named exceptions'));
  if (!head(PERSONA_DOC).includes('glyph bullets')) throw new Error('glyph bullets did not move above named exceptions');
  if (head(PRE_0016_PERSONA_DOC).includes('glyph bullets')) throw new Error('the guard persona already had them moved');

  const sql = [
    '-- Ruling 7, finished. The post-shape lines under `named exceptions` were out of reach of the',
    '-- heading slice, so every non-post run still received them. Guarded on what 0015 wrote.',
    'UPDATE "settings"',
    `   SET "data" = jsonb_set("data", '{personaDoc}', to_jsonb(${dq(PERSONA_DOC)}::text))`,
    ' WHERE "id" = 1',
    `   AND "data"->>'personaDoc' = ${dq(PRE_0016_PERSONA_DOC)};`,
  ].join('\n');

  await writeFile(OUT, `${sql}\n`, 'utf8');
  console.log(`wrote ${OUT}: persona ${PRE_0016_PERSONA_DOC.length} -> ${PERSONA_DOC.length}`);
}

void main();
