import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseExport, classifyWorkbook } from '../src/analytics/export-parser';
import { XlsxShapeError } from '../src/analytics/xlsx-parser';
import type { ParsedAggregate, ParsedSinglePost } from '../src/analytics/export-types';

const DIR = 'test/fixtures/synthetic-exports';
const TWIN_URL = 'https://www.linkedin.com/posts/user-example_synthetic-twin-post-share-9990000000000000101-AAAA';

describe('classifyWorkbook', () => {
  it('rejects unknown signatures, naming the sheets found', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Foo'); wb.addWorksheet('Bar');
    expect(() => classifyWorkbook(wb)).toThrow(XlsxShapeError);
    expect(() => classifyWorkbook(wb)).toThrow(/Foo.*Bar|Bar.*Foo/);
  });
});

describe('parseExport — aggregate', () => {
  let agg: ParsedAggregate;
  it('classifies and carries the window from the Descoberta period row', async () => {
    const parsed = await parseExport(await readFile(`${DIR}/aggregate.xlsx`));
    expect(parsed.kind).toBe('aggregate');
    agg = parsed as ParsedAggregate;
    expect(agg.window).toEqual({ start: '2026-05-11', end: '2026-08-08' });
  });

  it('daily profile rows: 90 days x2 engagement metrics + followers incl. zero days', () => {
    expect(agg.profile.filter((r) => r.metric === 'impressions')).toHaveLength(90);
    expect(agg.profile.filter((r) => r.metric === 'engagements')).toHaveLength(90);
    expect(agg.profile.filter((r) => r.metric === 'followers_new')).toHaveLength(90);
    expect(agg.profile).toContainEqual({ metric: 'impressions', date: '2026-05-17', value: 42 });
    expect(agg.profile).toContainEqual({ metric: 'engagements', date: '2026-05-18', value: 5 });
    expect(agg.profile).toContainEqual({ metric: 'followers_new', date: '2026-05-16', value: 1 });
    expect(agg.profile).toContainEqual({ metric: 'followers_total', date: '2026-08-08', value: 500 });
  });

  it('window metrics: 2 account rows + 3 engagement-table + 14 impressions-table post rows', () => {
    expect(agg.windowMetrics).toContainEqual({ url: null, metric: 'impressions', value: 2400 });
    expect(agg.windowMetrics).toContainEqual({ url: null, metric: 'members_reached', value: 1100 });
    expect(agg.windowMetrics.filter((r) => r.url !== null && r.metric === 'engagements')).toHaveLength(3);
    expect(agg.windowMetrics.filter((r) => r.url !== null && r.metric === 'impressions')).toHaveLength(14);
    expect(agg.windowMetrics).toContainEqual({ url: TWIN_URL, metric: 'impressions', value: 1200 });
    expect(agg.windowMetrics).toContainEqual({ url: TWIN_URL, metric: 'engagements', value: 28 });
  });

  it('dim post seeds: 14 unique urls with dates', () => {
    expect(agg.dimPosts).toHaveLength(14);
    expect(agg.dimPosts).toContainEqual({ url: TWIN_URL, publishedAt: '2026-07-02' });
  });

  it('account audience rows survive with raw percents', () => {
    expect(agg.audience).toHaveLength(42);
    expect(agg.audience).toContainEqual({ dimension: 'location', segment: 'São Paulo e Região', value: 38, unit: 'percent' });
    expect(agg.audience).toContainEqual({ dimension: 'company_size', segment: 'Mais de 10.001 funcionários', value: 8, unit: 'percent' });
  });
});

describe('parseExport — single post', () => {
  it('video post: video metrics parsed, first Reações occurrence wins, floor metrics captured', async () => {
    const p = (await parseExport(await readFile(`${DIR}/single-post-video.xlsx`))) as ParsedSinglePost;
    expect(p.kind).toBe('single_post');
    expect(p.publishedAt).toBe('2026-06-02T08:30:00.000-03:00');
    const m = new Map(p.lifetime.map((r) => [r.metric, r.value]));
    expect(m.get('impressions')).toBe(500);
    expect(m.get('members_reached')).toBe(200);
    expect(m.get('video_views')).toBe(120);
    expect(m.get('video_watch_time_seconds')).toBe(1215);
    expect(m.get('video_avg_watch_time_seconds')).toBe(10);
    expect(m.get('reactions')).toBe(15);
    expect(m.get('comments')).toBe(2);
    expect(m.get('reposts')).toBe(0);
    expect(m.get('saves')).toBe(0);
    expect(m.get('sends')).toBe(0);
    expect(m.get('premium_button_engagements')).toBe(0);
    expect(m.get('profile_views')).toBe(3);
    expect(m.get('follows_gained')).toBe(1);
    expect(p.lifetime).toHaveLength(m.size); // dedup invariant
    expect(p.audience).toContainEqual({ dimension: 'location', segment: 'São Paulo e Região', value: 35, unit: 'percent' });
  });

  it('non-video twin: no video metrics, menos-de-1% convention, url passthrough', async () => {
    const p = (await parseExport(await readFile(`${DIR}/single-post-twin-a.xlsx`))) as ParsedSinglePost;
    expect(p.postUrl).toBe(TWIN_URL);
    const m = new Map(p.lifetime.map((r) => [r.metric, r.value]));
    expect(m.get('impressions')).toBe(1200);
    expect(m.get('members_reached')).toBe(700);
    expect(m.get('reactions')).toBe(22);
    expect(m.get('comments')).toBe(7);
    expect(m.get('follows_gained')).toBe(4);
    expect(m.has('video_views')).toBe(false);
    expect(p.audience).toContainEqual({ dimension: 'job_title', segment: 'Desenvolvedor de front-end', value: 0.5, unit: 'percent' });
  });
});
