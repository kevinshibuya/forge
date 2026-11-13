import { describe, expect, it } from 'vitest';
import { DraftOutputSchema, enforcedJsonSchema, TriageOutputSchema } from '@forge/shared';
import type { EngineEvent, EngineRequest } from '../engine.interface';
import { fixture, scriptedFetch, type Script } from '../../../test/helpers/scripted-fetch';
import { OpenAiEngine } from './openai.engine';

function request(over: Partial<EngineRequest> = {}): EngineRequest {
  return {
    kind: 'draft', model: 'gpt-5.6-terra', effort: null, maxOutputTokens: 16384,
    system: [{ text: 'constitution', cache: true }, { text: 'exemplars' }], user: 'the idea',
    outputSchema: enforcedJsonSchema(DraftOutputSchema), timeoutMs: 5000, ...over,
  };
}

async function run(script: Script, over: Partial<EngineRequest> = {}) {
  const { fetch, sent } = scriptedFetch(script);
  const events: EngineEvent[] = [];
  const result = await new OpenAiEngine({ apiKey: 'sk-test', fetch }).run(request(over), (e) => events.push(e));
  return { result, sent, events };
}

const apiError = (type: string, code: string | null = null) => ({ error: { message: `${type} happened`, type, code, param: null } });

describe('OpenAiEngine', () => {
  it('streams a structured result, restores optionals, and stores the uncached input count', async () => {
    const { result, sent, events } = await run({ sse: fixture('openai', 'success.sse'), headers: { 'x-request-id': 'req_1' } });
    expect(result.failureKind).toBeUndefined();
    expect(result.structured).toEqual({ result: { body_linkedin: 'x', hashtags: [] } });
    expect(result.usage).toEqual({ inputTokens: 1000, cacheReadTokens: 4000, outputTokens: 300 });
    expect(result.providerRequestId).toBe('req_1');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.instructions).toBe('constitution\n\nexemplars');
    expect(sent[0]!.body.input).toBe('the idea');
    expect(sent[0]!.body.max_output_tokens).toBe(16384);
    expect(events.some((e) => e.type === 'chunk' && e.data.includes('body_linkedin'))).toBe(true);
  });

  it('sends a strict schema: every payload key required, image_concept nullable, anyOf for oneOf', async () => {
    const { sent } = await run({ sse: fixture('openai', 'success.sse') });
    const format = sent[0]!.body.text.format;
    expect(format).toMatchObject({ type: 'json_schema', name: 'result', strict: true });
    const payload = format.schema.properties.result.anyOf[0];
    expect([...payload.required].sort()).toEqual(['body_linkedin', 'hashtags', 'image_concept', 'sources']);
    expect(payload.properties.image_concept.anyOf).toContainEqual({ type: 'null' });
    expect(JSON.stringify(format.schema)).not.toContain('oneOf');
  });

  it('returns plain text when the request has no schema', async () => {
    const { result, sent } = await run({ sse: fixture('openai', 'text.sse') }, { outputSchema: undefined });
    expect(result.output).toBe('plain text answer');
    expect(result.structured).toBeUndefined();
    expect('text' in sent[0]!.body).toBe(false);
  });

  it('times out mid-stream; OpenAI reports usage only at the end, so none arrives', async () => {
    const { result, sent } = await run({ sse: fixture('openai', 'start-only.sse'), open: true }, { timeoutMs: 50 });
    expect(result.failureKind).toBe('timeout');
    expect(result.usage).toBeUndefined();
    expect(sent[0]!.signal?.aborted).toBe(true);
  });

  it('times out before the first byte', async () => {
    const { result } = await run({ hang: true }, { timeoutMs: 50 });
    expect(result.failureKind).toBe('timeout');
  });

  it('maps a 429 with retry-after 0 to a quota retried at once', async () => {
    const { result } = await run({ json: apiError('rate_limit_exceeded'), status: 429, headers: { 'retry-after': '0' } });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toEqual({ afterMs: 0 });
  });

  it('maps a 429 without retry-after to quota that is not retried', async () => {
    const { result } = await run({ json: apiError('rate_limit_exceeded'), status: 429 });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toBeUndefined();
  });

  it('maps a 429 with retry-after to a retryable quota', async () => {
    const { result } = await run({ json: apiError('rate_limit_exceeded'), status: 429, headers: { 'retry-after': '3' } });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toEqual({ afterMs: 3000 });
  });

  it('maps an insufficient_quota 429 to quota that is not retried', async () => {
    const { result } = await run({ json: apiError('insufficient_quota', 'insufficient_quota'), status: 429, headers: { 'retry-after': '3' } });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toBeUndefined();
  });

  it('maps a 503 to quota retried after two seconds', async () => {
    const { result } = await run({ json: apiError('server_error'), status: 503 });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toEqual({ afterMs: 2000 });
  });

  it('maps a network failure to spawn_error', async () => {
    const { result } = await run({ reject: new TypeError('fetch failed') });
    expect(result.failureKind).toBe('spawn_error');
  });

  it('maps a 400 to nonzero_exit with the status in the detail', async () => {
    const { result } = await run({ json: apiError('invalid_request_error'), status: 400 });
    expect(result.failureKind).toBe('nonzero_exit');
    expect(result.errorDetail).toContain('400');
  });

  it('maps a refusal to the structured decline envelope', async () => {
    const { result } = await run({ sse: fixture('openai', 'refusal.sse') });
    expect(result.failureKind).toBe('declined');
    expect(result.structured).toEqual({ result: { outcome: 'declined', reason: 'not this one' } });
  });

  it('maps a max_output_tokens cut to invalid_output with its usage', async () => {
    const { result } = await run({ sse: fixture('openai', 'incomplete.sse') });
    expect(result.failureKind).toBe('invalid_output');
    expect(result.usage?.outputTokens).toBe(300);
  });

  it('carries the request id on a 429', async () => {
    const { result } = await run({ json: apiError('rate_limit_exceeded'), status: 429, headers: { 'x-request-id': 'req_429', 'retry-after': '3' } });
    expect(result.failureKind).toBe('quota');
    expect(result.providerRequestId).toBe('req_429');
  });

  it('keeps the partial output and the request id on a timeout after text arrived', async () => {
    const { result } = await run({ sse: fixture('openai', 'partial.sse'), open: true, headers: { 'x-request-id': 'req_t' } }, { timeoutMs: 50 });
    expect(result.failureKind).toBe('timeout');
    expect(result.output).toContain('{"result":');
    expect(result.providerRequestId).toBe('req_t');
  });

  it('keeps the usage when the body errors after the terminal event', async () => {
    const { result } = await run({ sse: fixture('openai', 'success.sse'), then: new Error('reset') });
    expect([result.failureKind, result.errorDetail]).toEqual(['other', 'reset']);
    expect(result.usage).toEqual({ inputTokens: 1000, cacheReadTokens: 4000, outputTokens: 300 });
  });

  it('reports no cache read when the provider sent no detail', async () => {
    const { result } = await run({ sse: fixture('openai', 'no-cache-detail.sse') }, { outputSchema: undefined });
    expect(result.usage).toEqual({ inputTokens: 5000, outputTokens: 300 });
  });

  it('refuses images without calling the provider', async () => {
    const { result, sent } = await run({ sse: fixture('openai', 'success.sse') }, { images: ['/x.png'] });
    expect(result.failureKind).toBe('other');
    expect(sent).toHaveLength(0);
  });

  it('sends reasoning effort only when the row sets one', async () => {
    const withEffort = await run({ sse: fixture('openai', 'success.sse') }, { effort: 'high' });
    expect(withEffort.sent[0]!.body.reasoning).toEqual({ effort: 'high' });
    const without = await run({ sse: fixture('openai', 'text.sse') }, { effort: null, outputSchema: enforcedJsonSchema(TriageOutputSchema) });
    expect('reasoning' in without.sent[0]!.body).toBe(false);
  });
});
