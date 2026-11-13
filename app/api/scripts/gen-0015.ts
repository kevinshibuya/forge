/**
 * Generates src/db/migrations/0015_ruling_edits.sql from seed-content.ts.
 *
 *   npx tsx scripts/gen-0015.ts
 *
 * Applies the six content rulings of 2026-09-03 to a live database: the persona gains a
 * `post structure:` section and a named exception for the closing aphorism, the `unslop` doc stops
 * banning `underscore` and `scaffolding` outright, and three seed rules are rewritten.
 *
 * Every statement is guarded on the stored text matching what 0012/0013 left byte for byte, so an
 * operator who edited any of it in Settings keeps their version. Re-running is a no-op.
 */
import { access, writeFile } from 'node:fs/promises';
import {
  PERSONA_DOC, PRE_0015_PERSONA_DOC, PRE_0015_UNSLOP_BODY, RULE_EDITS_0015, SEED_RULES, STYLE_DOCS,
} from '../src/seed/seed-content';

/** An applied migration is never edited (invariant 9). Regenerating over a committed file is how
 *  that gets violated by accident, so this refuses unless asked twice. */
async function refuseIfCommitted(out: string): Promise<void> {
  if (process.argv.includes('--force')) return;
  const exists = await access(out).then(() => true, () => false);
  if (!exists) return;
  console.error(`${out} already exists and may be applied. Re-run with --force to overwrite.`);
  process.exit(1);
}

const OUT = 'src/db/migrations/0015_ruling_edits.sql';
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
  if (PERSONA_DOC === PRE_0015_PERSONA_DOC) throw new Error('persona is unchanged; nothing to migrate');
  if (doc.body === PRE_0015_UNSLOP_BODY) throw new Error('doc body is unchanged; nothing to migrate');
  if (!PERSONA_DOC.includes('\npost structure:')) throw new Error('the new persona has no post-structure section');
  // Every rewrite must land on a rule the seed actually ships, or the migration and the seed would
  // disagree the moment someone seeds a fresh database.
  for (const edit of RULE_EDITS_0015) {
    if (!SEED_RULES.some((r) => r.rule === edit.after)) throw new Error(`RULE_EDITS_0015 "after" is not a seed rule: ${edit.after.slice(0, 60)}`);
    if (SEED_RULES.some((r) => r.rule === edit.before)) throw new Error(`RULE_EDITS_0015 "before" is still a seed rule: ${edit.before.slice(0, 60)}`);
  }

  const statements = [
    '-- The six content rulings of 2026-09-03. Every statement is guarded on the text 0012/0013',
    '-- left, so an operator edit is never clobbered, and re-running changes nothing.',
    '',
    '-- 1. Persona: post-shape lines move under their own heading (the assembler drops that section',
    '-- for kinds that do not write posts), and the closing aphorism becomes a named exception to the',
    '-- style doc line about perfect symmetry.',
    'UPDATE "settings"',
    `   SET "data" = jsonb_set("data", '{personaDoc}', to_jsonb(${dq(PERSONA_DOC)}::text))`,
    ' WHERE "id" = 1',
    `   AND "data"->>'personaDoc' = ${dq(PRE_0015_PERSONA_DOC)};`,
    '',
    '-- 2. unslop doc: `underscore` and `scaffolding` stop being flat bans and become judgement',
    '-- calls, which is what appendix D said they were all along.',
    'UPDATE "settings" AS s',
    `   SET "data" = jsonb_set(s."data", ARRAY['styleDocs', (d.idx - 1)::text, 'body'], to_jsonb(${dq(doc.body)}::text))`,
    '  FROM (',
    '    SELECT ordinality AS idx',
    '      FROM "settings",',
    `           jsonb_array_elements("data"->'styleDocs') WITH ORDINALITY AS e(doc, ordinality)`,
    '     WHERE "id" = 1',
    `       AND e.doc->>'id' = 'unslop'`,
    `       AND e.doc->>'body' = ${dq(PRE_0015_UNSLOP_BODY)}`,
    '     LIMIT 1',
    '  ) AS d',
    ' WHERE s."id" = 1;',
  ];

  RULE_EDITS_0015.forEach((edit, i) => {
    statements.push(
      '',
      `-- 3.${i + 1} Seed rule rewrite. Guarded on the old text AND on provenance, so a rule the`,
      '-- operator wrote or edited by hand is untouched.',
      'UPDATE "playbook_rules"',
      `   SET "rule" = ${dq(edit.after)}`,
      ` WHERE "rule" = ${dq(edit.before)}`,
      `   AND "provenance" = 'seed'`,
      `   AND "status" = 'active';`,
    );
  });

  await writeFile(OUT, `${statements.join('\n')}\n`, 'utf8');
  console.log(`wrote ${OUT}: persona ${PRE_0015_PERSONA_DOC.length} -> ${PERSONA_DOC.length}, body ${PRE_0015_UNSLOP_BODY.length} -> ${doc.body.length}, ${RULE_EDITS_0015.length} rules`);
}

void main();
