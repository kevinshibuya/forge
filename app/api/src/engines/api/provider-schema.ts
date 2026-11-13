import type { OutputJsonSchema } from '@forge/shared';

type Schema = Record<string, unknown>;

/** Keywords neither provider's structured-output grammar accepts. The post-hoc zod parse in the
 *  runner still enforces the bounds zod carries; `minItems` survives at 0 or 1. */
const STRIPPED = ['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'format', 'maxItems', '$schema'];

const isSchema = (v: unknown): v is Schema => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The shared envelope, rewritten for an api provider (plan narrowing 3): `oneOf` becomes `anyOf` and
 * the rejected keywords go, on every object, array item and union branch. `strict` (OpenAI) also
 * requires every property and makes a formerly optional one nullable; `restoreOptionals` undoes
 * that on the way back. Never mutates its input.
 */
export function toProviderSchema(schema: OutputJsonSchema, opts: { strict: boolean }): OutputJsonSchema {
  return transform(schema, opts.strict);
}

function transform(node: Schema, strict: boolean): Schema {
  const out: Schema = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED.includes(key)) continue;
    if (key === 'minItems' && typeof value === 'number' && value > 1) continue;
    if (key === 'oneOf' || key === 'anyOf') {
      out.anyOf = (value as Schema[]).map((b) => transform(b, strict));
    } else if (key === 'items' && isSchema(value)) {
      out.items = transform(value, strict);
    } else if (key === 'properties' && isSchema(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v as Schema, strict)]));
    } else {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  if (strict && isSchema(out.properties)) {
    const props = out.properties;
    const required = new Set((out.required as string[] | undefined) ?? []);
    for (const k of Object.keys(props)) {
      if (!required.has(k)) props[k] = { anyOf: [props[k], { type: 'null' }] };
    }
    out.required = Object.keys(props);
  }
  return out;
}

/**
 * Walks a parsed provider value beside the ORIGINAL schema and deletes a `null` property the
 * original neither required nor allowed as null, so `image_concept: null` becomes absent and a zod
 * `.optional()` parses. A union picks the branch whose properties cover the value's keys and whose
 * `const`s match.
 */
export function restoreOptionals(value: unknown, original: OutputJsonSchema): unknown {
  return restore(value, original);
}

function restore(value: unknown, schema: Schema): unknown {
  const union = (schema.oneOf ?? schema.anyOf) as Schema[] | undefined;
  if (union) {
    const branch = union.find((b) => fits(value, b));
    return branch ? restore(value, branch) : value;
  }
  if (Array.isArray(value)) return isSchema(schema.items) ? value.map((v) => restore(v, schema.items as Schema)) : value;
  if (!isSchema(value) || !isSchema(schema.properties)) return value;
  const props = schema.properties;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const prop = props[k];
    if (v === null && !required.has(k) && !(isSchema(prop) && allowsNull(prop))) continue;
    out[k] = isSchema(prop) ? restore(v, prop) : v;
  }
  return out;
}

function fits(value: unknown, branch: Schema): boolean {
  if (value === null) return allowsNull(branch);
  if (!isSchema(value)) return !isSchema(branch.properties);
  if (!isSchema(branch.properties)) return false;
  const props = branch.properties;
  return Object.entries(value).every(([k, v]) => {
    const prop = props[k];
    if (!isSchema(prop)) return false;
    return !('const' in prop) || prop.const === v;
  });
}

function allowsNull(schema: Schema): boolean {
  const t = schema.type;
  if (t === 'null' || (Array.isArray(t) && t.includes('null'))) return true;
  const union = (schema.oneOf ?? schema.anyOf) as Schema[] | undefined;
  return !!union?.some(allowsNull);
}
