/**
 * Canonical shape of a parsed LinkedIn export.
 *
 * The parsers are pure: they read a workbook and emit rows. They never touch the
 * database, the filesystem, or URN extraction — URLs pass through verbatim and the
 * ingest layer is what resolves them to posts.
 */

export type ProfileMetric = 'impressions' | 'engagements' | 'followers_new' | 'followers_total';
export type WindowMetric = 'impressions' | 'members_reached' | 'engagements';
export type AudienceDimension = 'company' | 'location' | 'company_size' | 'seniority' | 'industry' | 'job_title';

/** One account-level metric for one calendar day. `date` is YYYY-MM-DD. */
export interface ProfileMetricRow {
  metric: ProfileMetric;
  date: string;
  value: number;
}

/** A lifetime-to-date metric of a single post. `metric` is a registry name, not an enum. */
export interface LifetimeMetricRow {
  metric: string;
  value: number;
}

/** A metric scoped to the export's window. `url === null` means account level. */
export interface WindowMetricRow {
  url: string | null;
  metric: WindowMetric;
  value: number;
}

export interface AudienceRow {
  dimension: AudienceDimension;
  segment: string;
  value: number;
  unit: 'percent' | 'count';
}

/** A post the export mentions, with whatever publish date the export carried. */
export interface DimPostSeed {
  url: string;
  /** YYYY-MM-DD, or null when the export did not carry a usable date. */
  publishedAt: string | null;
}

export interface ParsedAggregate {
  kind: 'aggregate';
  /** Inclusive window bounds, YYYY-MM-DD. */
  window: { start: string; end: string };
  profile: ProfileMetricRow[];
  windowMetrics: WindowMetricRow[];
  /** Deduped by url, first occurrence wins. */
  dimPosts: DimPostSeed[];
  /** Account level. */
  audience: AudienceRow[];
}

export interface ParsedSinglePost {
  kind: 'single_post';
  postUrl: string;
  /** ISO 8601 with offset, resolved in America/Sao_Paulo. */
  publishedAt: string;
  /** Deduped by metric, first occurrence wins. */
  lifetime: LifetimeMetricRow[];
  /** Post level. */
  audience: AudienceRow[];
}

export type ParsedExport = ParsedAggregate | ParsedSinglePost;
