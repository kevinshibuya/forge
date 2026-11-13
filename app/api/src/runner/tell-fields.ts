import { lintTells, type RunTell } from '@forge/shared';

/**
 * Lint the string fields a run's caller declared as prose. A path is one of:
 *   `notes`             a bare key holding a string
 *   `hashtags[]`        an array of strings, recorded as `hashtags[2]`
 *   `proposals[].rule`  an array of objects, recorded as `proposals[0].rule`
 *
 * Missing, null and non-string values are skipped in silence: a nullable field
 * (RetroProposalSchema.rule) is a normal shape, not a lint error.
 */
export function collectTells(data: unknown, fields: string[]): RunTell[] {
  const found: RunTell[] = [];
  if (typeof data !== 'object' || data === null) return found;
  const record = data as Record<string, unknown>;

  for (const path of fields) {
    const parsed = /^([^[.]+)(\[\])?(?:\.([^[.]+))?$/.exec(path);
    if (!parsed) continue;
    const [, key, isArray, sub] = parsed;
    const value = record[key!];

    if (!isArray) {
      // `plan.headline`: one level of nesting, no array. Without this the sub-key was dropped
      // and the object itself linted, which is to say nothing was linted at all.
      if (sub) {
        if (typeof value === 'object' && value !== null) {
          collectInto(found, (value as Record<string, unknown>)[sub], path);
        }
        continue;
      }
      collectInto(found, value, key!);
      continue;
    }
    if (!Array.isArray(value)) continue;
    value.forEach((item, i) => {
      if (!sub) return collectInto(found, item, `${key}[${i}]`);
      if (typeof item === 'object' && item !== null) {
        collectInto(found, (item as Record<string, unknown>)[sub], `${key}[${i}].${sub}`);
      }
    });
  }

  return found;
}

function collectInto(found: RunTell[], value: unknown, field: string): void {
  if (typeof value !== 'string') return;
  for (const tell of lintTells(value)) found.push({ ...tell, field });
}
