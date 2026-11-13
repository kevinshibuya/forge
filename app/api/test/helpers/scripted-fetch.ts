import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One scripted answer to the SDK's fetch. `open: true` keeps the body stream open after the
 *  fixture, so only an abort ends it; `then` errors the body right after the fixture (a reset
 *  connection). `hang` never resolves the fetch at all. */
export type Script =
  | { sse: string; status?: number; headers?: Record<string, string>; open?: boolean; then?: Error }
  | { json: unknown; status: number; headers?: Record<string, string> }
  | { reject: Error }
  | { hang: true };

export interface Sent { url: string; body: Record<string, any>; signal: AbortSignal | undefined }

export function fixture(provider: 'anthropic' | 'openai', name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', provider, name), 'utf8');
}

const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

/** A fetch that behaves like the real one on abort (the pending promise or the open body errors)
 *  and records what the SDK sent. No network. */
export function scriptedFetch(script: Script): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    sent.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {}, signal });
    if ('reject' in script) throw script.reject;
    if ('hang' in script) {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(abortError()));
      });
    }
    if ('json' in script) {
      return new Response(JSON.stringify(script.json), {
        status: script.status, headers: { 'content-type': 'application/json', ...script.headers },
      });
    }
    const bytes = new TextEncoder().encode(script.sse);
    const then = script.then;
    // Erroring a stream drops its queued chunks, so `then` errors on the pull after the fixture.
    const body = then
      ? new ReadableStream<Uint8Array>({
        pulls: 0,
        pull(controller) { if (this.pulls++ === 0) controller.enqueue(bytes); else controller.error(then); },
      } as UnderlyingDefaultSource<Uint8Array> & { pulls: number })
      : new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          if (!script.open) controller.close();
          else signal?.addEventListener('abort', () => controller.error(abortError()));
        },
      });
    return new Response(body, {
      status: script.status ?? 200, headers: { 'content-type': 'text/event-stream', ...script.headers },
    });
  }) as typeof fetch;
  return { fetch: f, sent };
}
