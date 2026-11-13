import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REFUSAL, URL_FETCH } from '@forge/shared';
import { PINNED_LOOKUP, fetchArticle, isPrivateAddress, type PinnedAgent } from './url-article';

const fixture = (name: string) => readFile(path.join(__dirname, '..', '..', 'test', 'fixtures', 'inputs', name));

const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const redirect = (to: string) => new Response('', { status: 302, headers: { location: to } });

/** Every test injects both the resolver and the transport: nothing here touches the network. */
const publicLookup = async () => ['93.184.216.34'];

describe('isPrivateAddress', () => {
  it('knows the ranges the operator answers on', () => {
    for (const ip of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1',
      '172.31.255.255', '192.0.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '240.0.0.1',
      '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('lets a real public address through, in either family', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('treats an address it cannot parse as private, so the check never fails open', () => {
    for (const ip of ['', 'not-an-ip', '999.1.1.1', '10.1.2']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
});

describe('fetchArticle', () => {
  it('refuses a scheme that is not http or https', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchArticle('ftp://example.com/a', { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, refused: REFUSAL.badScheme });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a private host before the transport is ever asked to connect', async () => {
    // Sabotage-proved: with the private-address check removed, this spy fires and the test fails.
    const fetchImpl = vi.fn();
    const result = await fetchArticle('http://internal.example/a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: async () => ['127.0.0.1'],
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.privateAddress('internal.example') });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a host that resolves to nothing at all', async () => {
    const result = await fetchArticle('http://void.example/a', {
      fetchImpl: vi.fn() as unknown as typeof fetch,
      lookup: async () => [],
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.cannotResolve('void.example') });
  });

  it('refuses a name the resolver rejects, rather than letting it escape as a fault', async () => {
    // dns.lookup throws ENOTFOUND on a typo, and that used to leave fetchArticle as a 500 with a
    // stack where the operator wanted one sentence about their own link.
    const fetchImpl = vi.fn();
    const result = await fetchArticle('http://typo.example/a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); },
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.cannotResolve('typo.example') });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pins the socket to the addresses the check saw, so the name cannot resolve twice', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => html('<article><p>a paragraph long enough to be an article body for readability to keep it.</p></article>'));
    await fetchArticle('http://example.com/a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup,
    });

    const init = fetchImpl.mock.calls[0]![1] as unknown as RequestInit & { dispatcher: PinnedAgent };
    expect(init.dispatcher).toBeDefined();
    const pinned = init.dispatcher[PINNED_LOOKUP];
    const seen = await new Promise<{ address: string; family: number }[]>((resolve) => {
      pinned('example.com', { all: true }, (_e, addresses) => resolve(addresses as { address: string; family: number }[]));
    });
    expect(seen.map((a) => a.address)).toEqual(['93.184.216.34']);
  });

  it('reduces a page to its article, dropping the nav and the footer', async () => {
    const page = (await fixture('article.html')).toString('utf8');
    const result = await fetchArticle('http://example.com/a', {
      fetchImpl: (async () => html(page)) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    if (!result.ok) throw new Error(`expected an article, got ${result.refused}`);
    expect(result.title).toBe('What the fence is for');
    expect(result.text).toContain('A staged copy is not a convenience');
    expect(result.text).toContain('The third paragraph closes on the operator');
    expect(result.text).not.toContain('subscribe today');
    expect(result.text).not.toContain('all rights reserved');
    expect(result.text.startsWith('What the fence is for\n\n')).toBe(true);
  });

  it('treats a charset parameter as part of the same content type', async () => {
    const result = await fetchArticle('http://example.com/a', {
      fetchImpl: (async () => new Response('one line of plain text', {
        status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' },
      })) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    expect(result).toEqual({ ok: true, text: 'one line of plain text' });
  });

  it('refuses a page that is not text at all', async () => {
    const result = await fetchArticle('http://example.com/a.zip', {
      fetchImpl: (async () => new Response('PK', { status: 200, headers: { 'content-type': 'application/zip' } })) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.notTextPage('application/zip') });
  });

  it('reads a pdf served over http through the same converter as a dropped one', async () => {
    const pdf = await fixture('one-page.pdf');
    const result = await fetchArticle('http://example.com/a.pdf', {
      fetchImpl: (async () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } })) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    if (!result.ok) throw new Error(`expected text, got ${result.refused}`);
    expect(result.text).toContain('inputs fixture, page one');
  });

  it('names the status of a page that refused to answer', async () => {
    const result = await fetchArticle('http://example.com/a', {
      fetchImpl: (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.fetchFailed(404) });
  });

  it('gives up on a chain longer than the redirect limit', async () => {
    const fetchImpl = vi.fn(async (input: string) => redirect(`${String(input)}/next`));
    const result = await fetchArticle('http://example.com/a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup,
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.tooManyRedirects });
    expect(fetchImpl).toHaveBeenCalledTimes(URL_FETCH.maxRedirects + 1);
  });

  it('re-checks the address on every hop, so a redirect cannot reach the loopback api', async () => {
    const fetchImpl = vi.fn(async () => redirect('http://internal.example/a'));
    const result = await fetchArticle('http://example.com/a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: async (host) => (host === 'example.com' ? ['93.184.216.34'] : ['10.0.0.5']),
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.privateAddress('internal.example') });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-checks the scheme on every hop', async () => {
    const result = await fetchArticle('http://example.com/a', {
      fetchImpl: (async () => redirect('ftp://example.com/a')) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.badScheme });
  });

  it('stops reading a body past the cap rather than buffering it whole', async () => {
    const oversize = 'x'.repeat(URL_FETCH.maxBytes + 10);
    const result = await fetchArticle('http://example.com/a', {
      fetchImpl: (async () => new Response(oversize, { status: 200, headers: { 'content-type': 'text/plain' } })) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.refused).toContain('the cap is 5 MB');
  });

  it('refuses a page that never answers, on a real timer', async () => {
    const result = await fetchArticle('http://example.com/a', {
      timeoutMs: 20,
      lookup: publicLookup,
      fetchImpl: ((_input: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => { reject(init.signal?.reason); });
      })) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.fetchTimeout });
  });

  it('times out a server that answers its headers fast and then stalls the body', async () => {
    // The cap bounds how much we read, never how long we wait for it. With the timer cleared at
    // the headers, this hung for ever instead of refusing.
    const stalling = (_input: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener('abort', () => { controller.error(init.signal?.reason); });
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }));
    };

    const raced = await Promise.race([
      fetchArticle('http://example.com/a', {
        timeoutMs: 50, lookup: publicLookup, fetchImpl: stalling as unknown as typeof fetch,
      }),
      new Promise((resolve) => { setTimeout(() => resolve('hung'), 2000); }),
    ]);
    expect(raced).toEqual({ ok: false, refused: REFUSAL.fetchTimeout });
  });

  it('refuses a page with nothing an article parser can find', async () => {
    const result = await fetchArticle('http://example.com/a', {
      fetchImpl: (async () => html('<html><body></body></html>')) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    expect(result).toEqual({ ok: false, refused: REFUSAL.noArticle });
  });
});
