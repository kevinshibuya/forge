import { describe, it, expect, afterEach, vi } from 'vitest';
import { api, ApiError } from './client';

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

/** Stub `fetch` with a single canned response and hand back the spy. */
function stubFetch(res: Response) {
  const spy = vi.fn<(...args: FetchArgs) => Promise<Response>>().mockResolvedValue(res);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The `init` the single recorded call was made with. */
function initOf(spy: ReturnType<typeof stubFetch>): RequestInit {
  return spy.mock.calls[0]?.[1] ?? {};
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api — ok responses', () => {
  it('get returns the parsed body and prefixes /api', async () => {
    const spy = stubFetch(json({ id: 7 }));
    await expect(api.get('/posts/7')).resolves.toEqual({ id: 7 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('/api/posts/7');
    // `get` passes no init at all — no method, no headers.
    expect(spy.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('post targets the prefixed path with method POST', async () => {
    const spy = stubFetch(json({ ok: true }));
    await expect(api.post('/posts/7/body', { body: 'x' })).resolves.toEqual({ ok: true });
    expect(spy.mock.calls[0]?.[0]).toBe('/api/posts/7/body');
    expect(initOf(spy).method).toBe('POST');
  });

  it('patch targets the prefixed path with method PATCH', async () => {
    const spy = stubFetch(json({ ok: true }));
    await expect(api.patch('/posts/7', { hashtags: [] })).resolves.toEqual({ ok: true });
    expect(spy.mock.calls[0]?.[0]).toBe('/api/posts/7');
    expect(initOf(spy).method).toBe('PATCH');
  });

  it('del targets the prefixed path with method DELETE', async () => {
    const spy = stubFetch(json({ ok: true }));
    await expect(api.del('/posts/7')).resolves.toEqual({ ok: true });
    expect(spy.mock.calls[0]?.[0]).toBe('/api/posts/7');
    expect(initOf(spy).method).toBe('DELETE');
  });
});

describe('api — error shaping', () => {
  it("lifts a JSON body's message onto the ApiError", async () => {
    // This is the exact path that puts a server's 409 text into an ErrorNote.
    stubFetch(json({ message: 'post #4 is already linked to another import' }, 409));
    const err = await api.post('/analytics/link', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      message: 'post #4 is already linked to another import',
    });
  });

  it('falls back to the raw body when the JSON has no message field', async () => {
    const body = JSON.stringify({ error: 'Conflict', statusCode: 409 });
    stubFetch(new Response(body, { status: 409, headers: { 'content-type': 'application/json' } }));
    const err = await api.get('/posts').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, message: body });
  });

  it('uses a non-JSON body verbatim', async () => {
    const html = '<!doctype html><title>502 Bad Gateway</title>';
    stubFetch(new Response(html, { status: 502, headers: { 'content-type': 'text/html' } }));
    const err = await api.get('/runs').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, message: html });
  });

  it('carries the status through unchanged', async () => {
    stubFetch(new Response('nope', { status: 500 }));
    const err = await api.del('/posts/7').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});

describe('api — request bodies', () => {
  it('post with a body sends JSON and the content-type', async () => {
    const spy = stubFetch(json({ ok: true }));
    await api.post('/posts/7/refine-selection', { start: 0, end: 4 });
    const init = initOf(spy);
    expect(init.body).toBe('{"start":0,"end":4}');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('post with no body sends no body', async () => {
    const spy = stubFetch(json({ ok: true }));
    await api.post('/posts/7/publish');
    // Anchored on purpose: `initOf` falls back to `{}`, so without this the assertion below
    // would also pass if the fetch seam went dark and no request was made at all.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(initOf(spy).body).toBeUndefined();
  });

  it('upload posts FormData under the field name file, with no content-type', async () => {
    const spy = stubFetch(json({ assetId: 3 }));
    const file = new File(['pixels'], 'shot.png', { type: 'image/png' });
    await api.upload('/assets', file);

    const init = initOf(spy);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
    // Setting content-type by hand would strip the multipart boundary.
    expect(init.headers).toBeUndefined();
  });
});

describe('api — a handler that returned nothing', () => {
  it('resolves an empty 200 instead of choking on the absent body', async () => {
    // A Nest handler returning void answers 200 with no body, and res.json() throws on that. It
    // rejected the mutation of a DELETE whose write had already succeeded, so the list it should
    // have invalidated kept showing the removed row under a spurious failure.
    stubFetch(new Response('', { status: 200, headers: { 'content-length': '0' } }));
    await expect(api.del('/posts/4/inputs/1')).resolves.toBeUndefined();
  });

  it('resolves a 204 the same way', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api.del('/posts/4/inputs/1')).resolves.toBeUndefined();
  });

  it('still parses a body when there is one', async () => {
    stubFetch(json({ id: 7 }));
    await expect(api.del('/images/posts/4/3')).resolves.toEqual({ id: 7 });
  });
});
