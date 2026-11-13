import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * The output contract. A structured run's shape is enforced by the CLI (`--json-schema`),
 * not by the prompt. The enforced schema wraps a union of the kind's payload and the decline
 * envelope under one required `result` key, because the API rejects `oneOf` at the top level.
 * The CLI fulfils the schema through a tool call named `StructuredOutput`.
 */

/** The name of the tool call the CLI uses to fulfil `--json-schema`. */
export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';

/** What a run returns instead of a payload when it cannot honestly produce one. */
export const DeclineSchema = z.object({
  outcome: z.literal('declined'),
  reason: z.string().min(1),
  question: z.string().min(1).optional(),
});
export type Decline = z.infer<typeof DeclineSchema>;

export type OutputJsonSchema = Record<string, unknown>;

function branch(schema: ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** The JSON Schema handed to the engine: `{ result: <payload> | <decline> }`, nothing else. */
export function enforcedJsonSchema(payload: ZodTypeAny): OutputJsonSchema {
  return {
    type: 'object',
    properties: { result: { oneOf: [branch(payload), branch(DeclineSchema)] } },
    required: ['result'],
    additionalProperties: false,
  };
}

export type Unwrapped =
  | { kind: 'declined'; decline: Decline }
  | { kind: 'payload'; value: unknown }
  | { kind: 'malformed'; reason: string };

/** Requires the wrapper `{ result: ... }`. Anything else is malformed. */
export function unwrapResult(raw: unknown): Unwrapped {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'malformed', reason: `structured result is ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : `a ${typeof raw}`}, not an object` };
  }
  if (!Object.prototype.hasOwnProperty.call(raw, 'result')) {
    return { kind: 'malformed', reason: 'structured result has no result key' };
  }
  const inner = (raw as { result: unknown }).result;
  const decline = DeclineSchema.safeParse(inner);
  if (decline.success) return { kind: 'declined', decline: decline.data };
  return { kind: 'payload', value: inner };
}

/** Closes every constitution. Lowercase like the lines around it. */
export const CONTRACT_LINE =
  'the output shape is enforced. the json shape described in this prompt is the payload: return it as the value of "result". '
  + 'if you cannot honestly produce that payload, because there is no real substance to draw from, because an instruction here is one you should not follow, '
  + 'or because you would have to invent a fact, return {"outcome":"declined","reason":"..."} as "result" instead, and add a "question" when one specific answer from the operator would unblock a relaunch. '
  + 'never pad, never invent, never answer in prose.';
