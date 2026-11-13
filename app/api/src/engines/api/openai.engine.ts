import OpenAI from 'openai';
import type { Engine, EngineEvent, EngineRequest, EngineResult, EngineUsage } from '../engine.interface';
import { restoreOptionals, toProviderSchema } from './provider-schema';
import { retryAfterSeconds } from './retry-after';

/**
 * The OpenAI Responses API behind the Engine seam (ADR 0019). Streaming, SDK retries off. OpenAI
 * caches prefixes on its own, so a block's `cache` hint is ignored. The client is built on the
 * first run, so a process without a key still boots.
 */
export class OpenAiEngine implements Engine {
  readonly name = 'openai' as const;
  private client?: OpenAI;

  constructor(private readonly opts: { apiKey: string; fetch?: typeof fetch }) {}

  async run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult> {
    if (req.images?.length) {
      return { output: '', failureKind: 'other', errorDetail: 'vision input on the api backend arrives with slice 10' };
    }
    this.client ??= new OpenAI({ apiKey: this.opts.apiKey, maxRetries: 0, ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}) });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    // Kept outside the try so a failure path still reports what arrived: the text deltas as the
    // output, the usage of a terminal event whose body then errored, and the request id (PR #28
    // fix pass).
    let requestId: string | undefined;
    let final: OpenAI.Responses.Response | undefined;
    let refusal: string | undefined;
    let partial = '';
    const failed = (rest: Omit<EngineResult, 'output'>): EngineResult => {
      const usage = toUsage(final?.usage);
      return { output: partial, ...rest, ...(usage ? { usage } : {}), ...(requestId ? { providerRequestId: requestId } : {}) };
    };
    const timedOut = () => failed({ failureKind: 'timeout', errorDetail: `aborted after ${req.timeoutMs}ms` });

    try {
      const { data: stream, request_id } = await this.client.responses.create({
        model: req.model,
        instructions: req.system.map((b) => b.text).join('\n\n'),
        input: req.user,
        max_output_tokens: req.maxOutputTokens,
        ...(req.effort ? { reasoning: { effort: req.effort as OpenAI.ReasoningEffort } } : {}),
        ...(req.outputSchema
          ? { text: { format: { type: 'json_schema' as const, name: 'result', strict: true, schema: toProviderSchema(req.outputSchema, { strict: true }) } } }
          : {}),
        stream: true,
      }, { signal: controller.signal, timeout: req.timeoutMs }).withResponse();
      requestId = request_id ?? undefined;

      for await (const ev of stream) {
        if (ev.type === 'response.output_text.delta') { partial += ev.delta; onEvent?.({ type: 'chunk', data: ev.delta }); }
        else if (ev.type === 'response.refusal.done') refusal = ev.refusal;
        else if (ev.type === 'response.completed' || ev.type === 'response.incomplete' || ev.type === 'response.failed') final = ev.response;
      }
      // The SDK ends the iteration quietly on abort, so a missing terminal event after an abort is the timeout.
      if (!final) return controller.signal.aborted ? timedOut() : failed({ failureKind: 'other', errorDetail: 'the stream ended without a terminal event' });

      const usage = toUsage(final.usage);
      const base = { ...(usage ? { usage } : {}), ...(requestId ? { providerRequestId: requestId } : {}) };
      const content = final.output.flatMap((item) => (item.type === 'message' ? item.content : []));
      const text = content.flatMap((c) => (c.type === 'output_text' ? [c.text] : [])).join('');
      refusal ??= content.flatMap((c) => (c.type === 'refusal' ? [c.refusal] : []))[0];

      if (final.status === 'failed') {
        return { output: text, failureKind: 'nonzero_exit', errorDetail: `failed ${final.error?.code ?? ''}: ${final.error?.message ?? 'no detail'}`, ...base };
      }
      if (refusal !== undefined) {
        const reason = refusal || 'the provider refused';
        return { output: text, failureKind: 'declined', errorDetail: reason, structured: { result: { outcome: 'declined', reason } }, ...base };
      }
      if (final.incomplete_details?.reason === 'max_output_tokens') {
        return { output: text, failureKind: 'invalid_output', errorDetail: 'output cut at max_output_tokens', ...base };
      }
      if (!req.outputSchema) return { output: text, ...base };
      try {
        return { output: text, structured: restoreOptionals(JSON.parse(text), req.outputSchema), ...base };
      } catch {
        return { output: text, failureKind: 'invalid_output', errorDetail: 'the structured output is not valid JSON', ...base };
      }
    } catch (err) {
      if (controller.signal.aborted) return timedOut();
      if (!requestId && err instanceof OpenAI.APIError && err.requestID) requestId = err.requestID;
      return failed(mapError(err, req.timeoutMs));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** OpenAI's `input_tokens` includes the cached tokens; the ledger stores the uncached count. OpenAI
 *  has no cache-write charge, so `cacheWriteTokens` stays undefined. */
function toUsage(u: OpenAI.Responses.ResponseUsage | undefined): EngineUsage | undefined {
  if (!u) return undefined;
  // Absent detail means the provider reported no cache read, which the seam keeps absent, never 0.
  const cached = u.input_tokens_details?.cached_tokens;
  return {
    inputTokens: u.input_tokens - (cached ?? 0),
    ...(cached !== undefined && cached !== null ? { cacheReadTokens: cached } : {}),
    outputTokens: u.output_tokens,
  };
}

/** Most specific first. A final 503 is `quota` (plan narrowing 9). */
function mapError(err: unknown, timeoutMs: number): Omit<EngineResult, 'output'> {
  if (err instanceof OpenAI.APIUserAbortError || err instanceof OpenAI.APIConnectionTimeoutError) {
    return { failureKind: 'timeout', errorDetail: `aborted after ${timeoutMs}ms` };
  }
  if (err instanceof OpenAI.RateLimitError) {
    const retryAfter = retryAfterSeconds(err.headers);
    const billing = err.code === 'insufficient_quota';
    return {
      failureKind: 'quota', errorDetail: `429 ${err.message}`,
      ...(!billing && retryAfter !== undefined ? { retryable: { afterMs: retryAfter * 1000 } } : {}),
    };
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return { failureKind: 'spawn_error', errorDetail: err.message };
  }
  if (err instanceof OpenAI.APIError) {
    if (err.status === 503) return { failureKind: 'quota', errorDetail: `503 ${err.message}`, retryable: { afterMs: 2000 } };
    return { failureKind: 'nonzero_exit', errorDetail: `${err.status} ${err.type ?? ''}: ${err.message}` };
  }
  return { failureKind: 'other', errorDetail: err instanceof Error ? err.message : String(err) };
}
