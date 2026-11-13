/** The `retry-after` header in seconds, or undefined when there is none or it is not a number.
 *  Zero is a real instruction (retry at once), so an absent header is told apart from a parsed 0:
 *  `Number(null)` is 0. The HTTP-date form stays unretried (#24; both providers send seconds). */
export function retryAfterSeconds(headers: Headers | undefined): number | undefined {
  const header = headers?.get('retry-after');
  if (header == null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
