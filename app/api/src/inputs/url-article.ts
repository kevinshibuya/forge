import dns from 'node:dns';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { Agent } from 'undici';
import { REFUSAL, URL_FETCH } from '@forge/shared';
import { pdfText, type Converted } from './pdf-text';

export type { Converted } from './pdf-text';

const USER_AGENT = 'forge/1.0 (+attached input reader)';

/** The pinned resolver is hung off the agent under this key so a test can invoke it and prove the
 *  transport cannot resolve the name a second time. Nothing in production reads it. */
export const PINNED_LOOKUP = Symbol('pinnedLookup');

type LookupCallback = (
  err: Error | null,
  addresses: string | { address: string; family: number }[],
  family?: number,
) => void;
type PinnedLookup = (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void;
export type PinnedAgent = Agent & { [PINNED_LOOKUP]: PinnedLookup };

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
}

function octets(ip: string): [number, number, number, number] | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return undefined;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function v4IsPrivate(ip: string): boolean | undefined {
  const parsed = octets(ip);
  if (!parsed) return undefined;
  const [a, b, c] = parsed;
  if (a === 0) return true;                              // 0.0.0.0/8
  if (a === 10) return true;                             // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64/10, carrier grade nat
  if (a === 127) return true;                            // 127/8, loopback
  if (a === 169 && b === 254) return true;               // 169.254/16, link local
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true;      // 192.0.0.0/24, ietf protocol assignments
  if (a === 192 && b === 168) return true;               // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18/15, benchmarking
  if (a >= 224) return true;                             // 224/4 multicast and 240/4 reserved
  return false;
}

/**
 * Whether an address is one the operator's own machine or network answers on. An address that
 * does not parse is treated as private: the check exists to keep a run off the loopback api, and
 * failing open on an unrecognised form would defeat it.
 */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  if (bare.length === 0) return true;

  const v4 = v4IsPrivate(bare);
  if (v4 !== undefined) return v4;

  if (!bare.includes(':')) return true;
  if (bare === '::' || bare === '::0') return true;
  if (bare === '::1') return true;

  // The IPv4-mapped forms, both the dotted tail and the two hex groups it compresses to.
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
  if (dotted) return v4IsPrivate(dotted[1]!) ?? true;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare);
  if (hex) {
    const high = Number.parseInt(hex[1]!, 16);
    const low = Number.parseInt(hex[2]!, 16);
    return v4IsPrivate(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`) ?? true;
  }

  const head = bare.split(':')[0]!;
  if (/^f[cd]/.test(head)) return true;               // fc00::/7, unique local
  if (/^fe[89ab]/.test(head)) return true;            // fe80::/10, link local
  if (!/^[0-9a-f]{0,4}$/.test(head)) return true;
  return false;
}

async function resolveHost(host: string): Promise<string[]> {
  const answers = await dns.promises.lookup(host, { all: true });
  return answers.map((a) => a.address);
}

/**
 * An undici dispatcher whose connector can only resolve to the addresses the check already saw.
 * This is what closes the rebinding window: between the check and the socket, a second DNS answer
 * cannot appear. SNI and the Host header still carry the hostname, so TLS and vhosts are intact.
 */
export function pinnedAgent(addresses: readonly string[]): PinnedAgent {
  const lookup: PinnedLookup = (_hostname, options, callback) => {
    const entries = addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    if (options?.all) { callback(null, entries); return; }
    const first = entries[0]!;
    callback(null, first.address, first.family);
  };
  const agent = new Agent({ connect: { lookup: lookup as never } });
  return Object.assign(agent, { [PINNED_LOOKUP]: lookup });
}

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || octets(hostname) !== undefined;
}

function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function readCapped(response: Response, max: number): Promise<{ ok: true; buf: Buffer } | { ok: false; refused: string }> {
  const body = response.body;
  if (!body) {
    const whole = Buffer.from(await response.arrayBuffer());
    if (whole.byteLength > max) return { ok: false, refused: REFUSAL.overBytes(whole.byteLength) };
    return { ok: true, buf: whole };
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return { ok: false, refused: REFUSAL.overBytes(total) };
    }
    chunks.push(Buffer.from(value));
  }
  return { ok: true, buf: Buffer.concat(chunks) };
}

function articleFromHtml(html: string): Converted {
  const { document } = parseHTML(html);
  const parsed = new Readability(document as unknown as Document).parse();
  const body = normalise(parsed?.textContent ?? '');
  if (body.length === 0) return { ok: false, refused: REFUSAL.noArticle };

  const title = parsed?.title?.trim();
  // The title leads the stored text so the model reads what the page was called, not only its body.
  const text = title ? `${title}\n\n${body}` : body;
  return title ? { ok: true, text, title } : { ok: true, text };
}

/**
 * Fetches one page and reduces it to article text, or refuses in one sentence.
 *
 * Redirects are followed by hand rather than by the runtime, because every hop has to face the
 * address check again: a page that redirects to the operator's own loopback api is the whole
 * reason this reader exists.
 */
export async function fetchArticle(url: string, deps: FetchDeps = {}): Promise<Converted> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? resolveHost;
  const timeoutMs = deps.timeoutMs ?? URL_FETCH.timeoutMs;

  let current: URL;
  try {
    current = new URL(url.trim());
  } catch {
    return { ok: false, refused: REFUSAL.badScheme };
  }
  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    return { ok: false, refused: REFUSAL.badScheme };
  }

  for (let hop = 0; hop <= URL_FETCH.maxRedirects; hop += 1) {
    const host = current.hostname;
    let addresses: string[];
    if (isIpLiteral(host)) {
      addresses = [host.replace(/^\[|\]$/g, '')];
    } else {
      try {
        addresses = await lookup(host);
      } catch {
        // A name that does not resolve is a typo, not a fault: it used to escape as a 500.
        return { ok: false, refused: REFUSAL.cannotResolve(host) };
      }
    }
    if (addresses.length === 0) return { ok: false, refused: REFUSAL.cannotResolve(host) };
    if (addresses.some(isPrivateAddress)) return { ok: false, refused: REFUSAL.privateAddress(host) };

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(new Error(REFUSAL.fetchTimeout)); }, timeoutMs);
    // The timer covers the WHOLE hop, headers and body alike. Cleared when the headers arrived, a
    // server that answers fast and then stalls its body would hold the request open for ever: the
    // byte cap bounds how much we read, never how long we wait for it.
    try {
      let response: Response;
      try {
        // `dispatcher` is undici's, which Node's fetch honours but RequestInit does not declare.
        response = await fetchImpl(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain,application/pdf' },
          dispatcher: pinnedAgent(addresses),
        } as RequestInit);
      } catch (err) {
        if (controller.signal.aborted) return { ok: false, refused: REFUSAL.fetchTimeout };
        throw err;
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return { ok: false, refused: REFUSAL.fetchFailed(response.status) };
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { ok: false, refused: REFUSAL.badScheme };
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          return { ok: false, refused: REFUSAL.badScheme };
        }
        // The hop's body was never read; let the socket go rather than leaving it to keep-alive.
        await response.body?.cancel().catch(() => undefined);
        current = next;
        continue;
      }

      if (!response.ok) return { ok: false, refused: REFUSAL.fetchFailed(response.status) };

      let capped;
      try {
        capped = await readCapped(response, URL_FETCH.maxBytes);
      } catch (err) {
        // The abort reaches the body stream too, so a stalled read lands here.
        if (controller.signal.aborted) return { ok: false, refused: REFUSAL.fetchTimeout };
        throw err;
      }
      if (!capped.ok) return capped;

      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (type === 'text/html' || type === 'application/xhtml+xml') {
        return articleFromHtml(capped.buf.toString('utf8'));
      }
      if (type === 'text/plain' || type === 'text/markdown') {
        const text = normalise(capped.buf.toString('utf8'));
        return text.length === 0 ? { ok: false, refused: REFUSAL.noArticle } : { ok: true, text };
      }
      if (type === 'application/pdf') return pdfText(capped.buf);
      return { ok: false, refused: REFUSAL.notTextPage(type || 'unknown') };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, refused: REFUSAL.tooManyRedirects };
}
