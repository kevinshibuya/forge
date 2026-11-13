import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import type { Engine, EngineEvent, EngineRequest, EngineResult, EngineUsage } from '../engine.interface';
import { toProviderSchema } from './provider-schema';
import { retryAfterSeconds } from './retry-after';

/** Wire usage, as message_start and message_delta report it. */
type WireUsage = Partial<Record<'input_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens' | 'output_tokens', number | null>>;

/**
 * The Anthropic Messages API behind the Engine seam (ADR 0019). Streaming, SDK retries off: the
 * runner makes the one recorded retry from `retryable`. The client is built on the first run, so a
 * process without a key still boots.
 */
export class AnthropicEngine implements Engine {
  readonly name = 'anthropic' as const;
  private client?: Anthropic;

  constructor(private readonly opts: { apiKey: string; fetch?: typeof fetch }) {}

  async run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult> {
    if (req.images?.length) {
      return { output: '', failureKind: 'other', errorDetail: 'vision input on the api backend arrives with slice 10' };
    }
    this.client ??= new Anthropic({ apiKey: this.opts.apiKey, maxRetries: 0, ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}) });

    const outputConfig = {
      ...(req.effort ? { effort: req.effort as Anthropic.OutputConfig['effort'] } : {}),
      ...(req.outputSchema
        ? { format: { type: 'json_schema' as const, schema: toProviderSchema(req.outputSchema, { strict: false }) } }
        : {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    const wire: WireUsage = {};
    let started = false;
    // Kept outside the try so a failure path still reports what arrived: the text deltas as the
    // output, and the request id from the stream or the error (PR #28 fix pass).
    let stream: MessageStream | undefined;
    let partial = '';

    try {
      stream = this.client.messages.stream({
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: req.system.map((b) => ({ type: 'text' as const, text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}) })),
        messages: [{ role: 'user', content: req.user }],
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      }, { signal: controller.signal, timeout: req.timeoutMs });
      stream.on('streamEvent', (ev) => {
        // message_start's output_tokens is a placeholder; the real count comes on message_delta.
        if (ev.type === 'message_start') { started = true; const { output_tokens: _, ...input } = ev.message.usage; Object.assign(wire, input); }
        if (ev.type === 'message_delta') Object.assign(wire, pickDefined(ev.usage as WireUsage));
      });
      stream.on('text', (delta) => { partial += delta; onEvent?.({ type: 'chunk', data: delta }); });

      const message = await stream.finalMessage();
      const usage = toUsage(wire);
      const providerRequestId = stream.request_id ?? undefined;
      const base = { ...(usage ? { usage } : {}), ...(providerRequestId ? { providerRequestId } : {}) };
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');

      if (message.stop_reason === 'refusal') {
        const reason = message.stop_details?.explanation ?? 'the provider refused';
        return { output: text, failureKind: 'declined', errorDetail: reason, structured: { result: { outcome: 'declined', reason } }, ...base };
      }
      if (message.stop_reason === 'max_tokens') {
        return { output: text, failureKind: 'invalid_output', errorDetail: 'output cut at max_output_tokens', ...base };
      }
      if (!req.outputSchema) return { output: text, ...base };
      try {
        return { output: text, structured: JSON.parse(text) as unknown, ...base };
      } catch {
        return { output: text, failureKind: 'invalid_output', errorDetail: 'the structured output is not valid JSON', ...base };
      }
    } catch (err) {
      const usage = started ? toUsage(wire) : undefined;
      const providerRequestId = stream?.request_id ?? (err instanceof Anthropic.APIError ? err.requestID : undefined) ?? undefined;
      return {
        output: partial, ...mapError(err, req.timeoutMs),
        ...(usage ? { usage } : {}), ...(providerRequestId ? { providerRequestId } : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function pickDefined(u: WireUsage): WireUsage {
  return Object.fromEntries(Object.entries(u ?? {}).filter(([, v]) => v !== null && v !== undefined));
}

/** Anthropic's `input_tokens` is already the uncached count, so no subtraction. */
function toUsage(w: WireUsage): EngineUsage | undefined {
  const usage: EngineUsage = {};
  if (w.input_tokens != null) usage.inputTokens = w.input_tokens;
  if (w.cache_creation_input_tokens != null) usage.cacheWriteTokens = w.cache_creation_input_tokens;
  if (w.cache_read_input_tokens != null) usage.cacheReadTokens = w.cache_read_input_tokens;
  if (w.output_tokens != null) usage.outputTokens = w.output_tokens;
  return Object.keys(usage).length ? usage : undefined;
}

/** Most specific first. A final 529 or 503 is `quota` (plan narrowing 9). */
function mapError(err: unknown, timeoutMs: number): Omit<EngineResult, 'output'> {
  if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
    return { failureKind: 'timeout', errorDetail: `aborted after ${timeoutMs}ms` };
  }
  if (err instanceof Anthropic.RateLimitError) {
    const body = err.error as { error?: { details?: { error_code?: string } } } | undefined;
    const retryAfter = retryAfterSeconds(err.headers);
    const spendLimit = body?.error?.details?.error_code === 'enforced_spend_limit_reached';
    return {
      failureKind: 'quota', errorDetail: `429 ${err.message}`,
      ...(!spendLimit && retryAfter !== undefined ? { retryable: { afterMs: retryAfter * 1000 } } : {}),
    };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { failureKind: 'spawn_error', errorDetail: err.message };
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || err.status === 503 || err.type === 'overloaded_error') {
      return { failureKind: 'quota', errorDetail: `${err.status} ${err.type}: ${err.message}`, retryable: { afterMs: 2000 } };
    }
    return { failureKind: 'nonzero_exit', errorDetail: `${err.status} ${err.type}: ${err.message}` };
  }
  return { failureKind: 'other', errorDetail: err instanceof Error ? err.message : String(err) };
}
