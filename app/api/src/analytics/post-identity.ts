export type UrnType = 'activity' | 'share' | 'ugcPost';

export interface PostUrn {
  urn: string;
  type: UrnType;
  id: string;
}

/**
 * Matches the LinkedIn post type token followed by its numeric id, in either the
 * slug form (`...-ugcPost-9990000000000000102-BBBB`) or the urn form
 * (`urn:li:activity:9990000000000000105`). Case-sensitive: `ugcPost` only.
 */
const POST_URN_PATTERN = /(activity|share|ugcPost)[:-](\d+)/;

/**
 * Extracts the canonical post URN from a LinkedIn URL.
 *
 * Runs against the raw URL string — the type/id token is never percent-encoded,
 * so encoded slug text needs no decoding. The first match wins; no match is null.
 */
export function extractPostUrn(url: string): PostUrn | null {
  const match = POST_URN_PATTERN.exec(url);
  if (!match) return null;

  const [, rawType, id] = match;
  if (rawType === undefined || id === undefined) return null;
  const type = rawType as UrnType;

  return { urn: `urn:li:${type}:${id}`, type, id };
}
