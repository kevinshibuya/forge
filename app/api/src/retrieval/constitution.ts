import { CONTRACT_LINE, styleDocApplies, type RuleCategory, type Settings, type TextRunKind } from '@forge/shared';

/** The block every text prompt carries: who is writing, what the playbook has learned,
 *  and the style docs that apply to this kind of run. Pure, no DI, so every builder can
 *  call it and every spec can assert on the exact string.
 *
 *  Callers filter their own rules: draft passes all active rules, refine_selection passes
 *  voice only, and the kinds whose prompts own an id-bearing or fenced rule block of
 *  their own (retro, image_review) pass none. */
export interface AssembleConstitutionInput {
  kind: TextRunKind;
  settings: Pick<Settings, 'personaDoc' | 'styleDocs'>;
  rules: { category: RuleCategory; rule: string }[];
}

export const PRECEDENCE_LINE = 'where a style section and the persona disagree, the persona\'s named exceptions win.';
/** The closing line. It used to ask for JSON only; the shape is now enforced by the engine, and
 *  this line says where the prompt's shape example goes (`result`) and how to decline. The name is
 *  kept: the builders and their specs know it as the JSON line. */
export const JSON_ONLY_LINE = CONTRACT_LINE;

/** The kinds that actually write a post. Everything else gets the persona's voice without its
 *  post shape: a triage `notes` field has no arc to follow and no reader to close a question on. */
const POST_KINDS: ReadonlySet<TextRunKind> = new Set<TextRunKind>(['draft', 'refine_selection']);

/** The persona's post-shape section, sliced out by heading for kinds that do not write posts.
 *  Heading-driven so the operator keeps ONE editable persona doc: adding lines under
 *  `post structure:` in Settings is enough, no code change and no second field. A persona with no
 *  such heading is returned whole, which is what makes this safe against a hand-edited doc. */
export function personaFor(personaDoc: string, kind: TextRunKind): string {
  if (POST_KINDS.has(kind)) return personaDoc;
  const start = personaDoc.indexOf('\npost structure:');
  if (start === -1) return personaDoc;
  // Sections are separated by a blank line; the post-shape block runs to the next one, or to the
  // end when it is last.
  const rest = personaDoc.indexOf('\n\n', start + 1);
  const trimmed = rest === -1 ? personaDoc.slice(0, start) : personaDoc.slice(0, start) + personaDoc.slice(rest);
  return trimmed.trimEnd();
}

export function assembleConstitution(input: AssembleConstitutionInput): string {
  const { kind, settings, rules } = input;

  const sections: string[] = [`## persona\n${personaFor(settings.personaDoc, kind)}`];

  if (rules.length > 0) {
    sections.push(['## playbook rules', ...rules.map((r) => `- [${r.category}] ${r.rule}`)].join('\n'));
  }

  for (const doc of settings.styleDocs) {
    if (styleDocApplies(doc, kind)) sections.push(`## style: ${doc.name}\n${doc.body}`);
  }

  sections.push(PRECEDENCE_LINE, JSON_ONLY_LINE);

  return sections.join('\n\n');
}
