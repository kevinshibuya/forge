/**
 * Generates src/db/migrations/0012_style_docs_and_rule_rewrite.sql from seed-content.ts, so the
 * migration's strings cannot drift from the seed's. Run once by the implementer; the generated
 * .sql is committed and this script stays so a reviewer can regenerate and diff.
 *
 *   npx tsx scripts/gen-0012.ts
 *
 * Every statement is guarded and re-runnable except the first: statement 1 retires the active
 * seed rules and is deliberately not idempotent, because a second run would retire the rules
 * this migration just inserted.
 */
import { writeFile } from 'node:fs/promises';
import { LEGACY_PERSONA_DOC, LEGACY_UNSLOP_BODY, PERSONA_DOC, SEED_RULES, STYLE_DOCS } from '../src/seed/seed-content';

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

const OUT = 'src/db/migrations/0012_style_docs_and_rule_rewrite.sql';
const TAG = 'fq';

/** Dollar-quote a literal, refusing any text that could close the quote itself. */
function dq(text: string): string {
  const close = `$${TAG}$`;
  if (text.includes(close)) throw new Error(`text contains the dollar-quote tag ${close}`);
  return `${close}${text}${close}`;
}

/** The style docs exactly as 0012 wrote them. */
const APPLIED_DOCS = STYLE_DOCS.map((d) => (d.id === 'unslop' ? { ...d, body: LEGACY_UNSLOP_BODY } : d));

async function main(): Promise<void> {
  await refuseIfCommitted(OUT);
  const statements: string[] = [];

  statements.push(
    '-- 1. retire the seed rules this migration replaces. NOT re-runnable by design.\n'
    + 'UPDATE "playbook_rules" SET "status" = \'retired\', "retired_at" = now()\n'
    + ' WHERE "provenance" = \'seed\' AND "status" = \'active\';');

  for (const [i, rule] of SEED_RULES.entries()) {
    statements.push(
      `-- 2.${i + 1} ${rule.category}\n`
      + 'INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")\n'
      + `SELECT ${dq(rule.category)}::rule_category, ${dq(rule.rule)}, ${dq(rule.rationale)}, 'seed', 'active'\n`
      + ' WHERE NOT EXISTS (\n'
      + `   SELECT 1 FROM "playbook_rules" WHERE "rule" = ${dq(rule.rule)} AND "status" = 'active');`);
  }

  statements.push(
    '-- 3. swap the persona only while it still matches the old seed byte for byte.\n'
    + 'UPDATE "settings"\n'
    + `   SET "data" = jsonb_set("data", '{personaDoc}', to_jsonb(${dq(PERSONA_DOC)}::text))\n`
    + ` WHERE "id" = 1 AND "data"->>'personaDoc' = ${dq(LEGACY_PERSONA_DOC)};`);

  statements.push(
    '-- 4. append the seeded style docs, unless the unslop doc is already there.\n'
    + 'UPDATE "settings"\n'
    // LEGACY_UNSLOP_BODY, not the current body: this migration is applied, so it must keep
    // reproducing the bytes that were applied. 0013 carries the doc forward from here.
    + `   SET "data" = jsonb_set("data", '{styleDocs}', COALESCE("data"->'styleDocs', '[]'::jsonb) || ${dq(JSON.stringify(APPLIED_DOCS))}::jsonb)\n`
    + ' WHERE "id" = 1\n'
    + `   AND NOT (COALESCE("data"->'styleDocs', '[]'::jsonb) @> '[{"id":"unslop"}]'::jsonb);`);

  await writeFile(OUT, `${statements.join('\n--> statement-breakpoint\n')}\n`, 'utf8');
  console.log(`wrote ${OUT}: ${statements.length} statements, ${SEED_RULES.length} rules, ${STYLE_DOCS.length} style docs`);
}

void main();
