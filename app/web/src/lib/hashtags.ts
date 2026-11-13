/**
 * Canonical form for a post's hashtag array: every tag is `#` + a whitespace-free core,
 * duplicates collapse case-insensitively (first casing wins), and order is preserved.
 * The PATCH endpoint takes the wholesale array, so the editor normalizes before every write.
 */
export function normalizeHashtags(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of raw) {
    // Inner whitespace vanishes rather than splitting: "build in public" is one tag, not three.
    const core = tag.replace(/\s+/g, '').replace(/^#+/, '');
    if (core === '') continue; // a bare "#" (or nothing at all) is not a tag
    const normalized = `#${core}`;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}
