import { describe, expect, it } from 'vitest';
import { extractPostUrn } from '../src/analytics/post-identity';

const SHARE_SLUG = 'https://www.linkedin.com/posts/user-example_synthetic-twin-post-share-9990000000000000101-AAAA';
const UGC_SLUG = 'https://www.linkedin.com/posts/user-example_synthetic-video-post-ugcPost-9990000000000000102-BBBB';
const ENCODED_SLUG = 'https://www.linkedin.com/posts/user-example_gostaria-de-compartilhar-que-estou-come%C3%A7ando-ugcPost-9990000000000000107-h-P-';
const ACTIVITY_FEED = 'https://www.linkedin.com/feed/update/urn:li:activity:9990000000000000105/';

describe('extractPostUrn', () => {
  it('extracts share ids from slug urls', () => {
    expect(extractPostUrn(SHARE_SLUG)).toEqual({ urn: 'urn:li:share:9990000000000000101', type: 'share', id: '9990000000000000101' });
  });

  it('extracts ugcPost ids from slug urls, including percent-encoded slugs', () => {
    expect(extractPostUrn(UGC_SLUG)?.urn).toBe('urn:li:ugcPost:9990000000000000102');
    expect(extractPostUrn(ENCODED_SLUG)?.urn).toBe('urn:li:ugcPost:9990000000000000107');
  });

  it('extracts activity urns from feed/update urls', () => {
    expect(extractPostUrn(ACTIVITY_FEED)).toEqual({ urn: 'urn:li:activity:9990000000000000105', type: 'activity', id: '9990000000000000105' });
  });

  it('slug words like "compartilhar" never false-match; no digits after the type token is no match', () => {
    expect(extractPostUrn('https://www.linkedin.com/posts/user-example_eu-quero-compartilhar-algo-legal-hoje-aqui')).toBeNull();
    expect(extractPostUrn('https://linkedin.com/posts/retro-1')).toBeNull();
    expect(extractPostUrn('')).toBeNull();
  });
});
