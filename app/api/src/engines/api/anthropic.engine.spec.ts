import { describe, expect, it } from 'vitest';
import { enforcedJsonSchema, TriageOutputSchema, DraftOutputSchema } from '@forge/shared';
import type { EngineEvent, EngineRequest } from '../engine.interface';
import { fixture, scriptedFetch, type Script } from '../../../test/helpers/scripted-fetch';
import { AnthropicEngine } from './anthropic.engine';

function request(over: Partial<EngineRequest> = {}): EngineRequest {
  return {
    kind: 'triage', model: 'claude-haiku-4-5', effort: null, maxOutputTokens: 2048,
    system: [{ text: 'constitution', cache: true }], user: 'the idea',
    outputSchema: enforcedJsonSchema(TriageOutputSchema), timeoutMs: 5000, ...over,
  };
}

async function run(script: Script, over: Partial<EngineRequest> = {}) {
  const { fetch, sent } = scriptedFetch(script);
  const events: EngineEvent[] = [];
  const result = await new AnthropicEngine({ apiKey: 'sk-test', fetch }).run(request(over), (e) => events.push(e));
  return { result, sent, events };
}

const apiError = (type: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'error', error: { type, message: `${type} happened`, ...extra } });

describe('AnthropicEngine', () => {
  it('streams a structured result with cache usage and the request id', async () => {
    const { result, sent, events } = await run({ sse: fixture('anthropic', 'success.sse'), headers: { 'request-id': 'req_1' } });
    expect(result.failureKind).toBeUndefined();
    expect((result.structured as any).result.suggested_tier).toBe('T2');
    expect(result.usage).toEqual({ inputTokens: 1000, cacheWriteTokens: 800, cacheReadTokens: 0, outputTokens: 40 });
    expect(result.providerRequestId).toBe('req_1');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sent[0]!.body.output_config.format.type).toBe('json_schema');
    expect(sent[0]!.body.max_tokens).toBe(2048);
    expect(events.some((e) => e.type === 'chunk' && e.data.includes('suggested_tier'))).toBe(true);
  });

  it('returns plain text when the request has no schema', async () => {
    const { result } = await run({ sse: fixture('anthropic', 'text.sse') }, { outputSchema: undefined });
    expect(result.output).toBe('plain text answer');
    expect(result.structured).toBeUndefined();
  });

  it('times out after message_start with the usage that arrived', async () => {
    const { result, sent } = await run({ sse: fixture('anthropic', 'start-only.sse'), open: true }, { timeoutMs: 50 });
    expect(result.failureKind).toBe('timeout');
    expect(result.usage?.inputTokens).toBe(1000);
    expect(result.usage?.outputTokens).toBeUndefined();
    expect(sent[0]!.signal?.aborted).toBe(true);
  });

  it('times out before the first byte with no usage', async () => {
    const { result } = await run({ hang: true }, { timeoutMs: 50 });
    expect(result.failureKind).toBe('timeout');
    expect(result.usage).toBeUndefined();
  });

  it('maps a 429 with retry-after 0 to a quota retried at once', async () => {
    const { result } = await run({ json: apiError('rate_limit_error'), status: 429, headers: { 'retry-after': '0' } });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toEqual({ afterMs: 0 });
  });

  it('maps a 429 without retry-after to quota that is not retried', async () => {
    const { result } = await run({ json: apiError('rate_limit_error'), status: 429 });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toBeUndefined();
  });

  it('maps a 429 with retry-after to a retryable quota', async () => {
    const { result } = await run({ json: apiError('rate_limit_error'), status: 429, headers: { 'retry-after': '3' } });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toEqual({ afterMs: 3000 });
  });

  it('maps a spend-limit 429 to quota that is not retried', async () => {
    const { result } = await run({
      json: apiError('rate_limit_error', { details: { error_code: 'enforced_spend_limit_reached' } }),
      status: 429, headers: { 'retry-after': '3' },
    });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toBeUndefined();
  });

  it('maps a 529 to quota retried after two seconds', async () => {
    const { result } = await run({ json: apiError('overloaded_error'), status: 529 });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toEqual({ afterMs: 2000 });
    expect(result.errorDetail).toMatch(/^529 /);
  });

  it('maps a 503 to quota retried after two seconds, like a 529 (narrowing 9)', async () => {
    const { result } = await run({ json: apiError('api_error'), status: 503 });
    expect(result.failureKind).toBe('quota');
    expect(result.retryable).toEqual({ afterMs: 2000 });
    expect(result.errorDetail).toMatch(/^503 /);
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
    const { result } = await run({ sse: fixture('anthropic', 'refusal.sse') });
    expect(result.failureKind).toBe('declined');
    expect(result.structured).toEqual({ result: { outcome: 'declined', reason: 'not this one' } });
  });

  it('maps a max_tokens stop to invalid_output', async () => {
    const { result } = await run({ sse: fixture('anthropic', 'max-tokens.sse') });
    expect(result.failureKind).toBe('invalid_output');
    expect(result.usage?.outputTokens).toBe(40);
  });

  it('carries the request id on a 429', async () => {
    const { result } = await run({ json: apiError('rate_limit_error'), status: 429, headers: { 'request-id': 'req_429', 'retry-after': '3' } });
    expect(result.failureKind).toBe('quota');
    expect(result.providerRequestId).toBe('req_429');
  });

  it('keeps the partial output and the request id on a timeout after text arrived', async () => {
    const { result } = await run({ sse: fixture('anthropic', 'partial.sse'), open: true, headers: { 'request-id': 'req_t' } }, { timeoutMs: 50 });
    expect(result.failureKind).toBe('timeout');
    expect(result.output).toContain('{"result":');
    expect(result.usage?.inputTokens).toBe(1000);
    expect(result.providerRequestId).toBe('req_t');
  });

  it('refuses images without calling the provider', async () => {
    const { result, sent } = await run({ sse: fixture('anthropic', 'success.sse') }, { images: ['/x.png'] });
    expect(result.failureKind).toBe('other');
    expect(sent).toHaveLength(0);
  });

  it('sends effort and format in one output_config, and none when neither is set', async () => {
    const both = await run({ sse: fixture('anthropic', 'success.sse') }, {
      effort: 'high', outputSchema: enforcedJsonSchema(DraftOutputSchema),
    });
    expect(both.sent[0]!.body.output_config.effort).toBe('high');
    expect(both.sent[0]!.body.output_config.format.schema.properties.result.anyOf).toHaveLength(2);
    const neither = await run({ sse: fixture('anthropic', 'text.sse') }, { effort: null, outputSchema: undefined });
    expect('output_config' in neither.sent[0]!.body).toBe(false);
    expect('thinking' in neither.sent[0]!.body).toBe(false);
  });
});
