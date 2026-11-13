import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseExport } from '../src/analytics/export-parser';
import { parseDuration, XlsxShapeError } from '../src/analytics/xlsx-parser';
import type { AudienceDimension, ParsedSinglePost } from '../src/analytics/export-types';

const FIXTURE = 'test/fixtures/synthetic-exports/seed-post.xlsx';

// The synthetic stand-in for post #1's export, the file the seed ingests
// (scripts/make-synthetic-exports.mjs). Read off the canonical rows.
describe('parseExport — seed export', () => {
  it('parses the seed export exactly', async () => {
    const parsed = (await parseExport(await readFile(FIXTURE))) as ParsedSinglePost;
    expect(parsed.kind).toBe('single_post');
    expect(parsed.postUrl).toBe(
      'https://www.linkedin.com/posts/seed-example_synthetic-twin-post-share-9990000000000000101-AAAA',
    );
    expect(parsed.publishedAt).toBe('2026-07-02T11:00:00.000-03:00');

    const m = new Map(parsed.lifetime.map((r) => [r.metric, r.value]));
    expect(m.get('impressions')).toBe(1000);
    expect(m.get('members_reached')).toBe(600);
    expect(m.get('profile_views')).toBe(3);
    expect(m.get('follows_gained')).toBe(4);
    expect(m.get('reactions')).toBe(20); // FIRST occurrence, not the 13/0 sub-rows
    expect(m.get('comments')).toBe(6);
    expect(m.get('reposts')).toBe(0);
    expect(m.get('saves')).toBe(0);

    const of = (dimension: AudienceDimension) => parsed.audience.filter((r) => r.dimension === dimension);
    expect(of('seniority')[0]).toEqual({ dimension: 'seniority', segment: 'Iniciante', value: 20, unit: 'percent' });
    expect(of('seniority')).toHaveLength(4);
    expect(of('location')[0]).toEqual({ dimension: 'location', segment: 'São Paulo e Região', value: 6, unit: 'percent' });
    expect(of('location')).toHaveLength(9);
    expect(of('job_title')).toHaveLength(2);
    expect(of('company')).toEqual([{ dimension: 'company', segment: 'Empresa Exemplo Ltda', value: 0.5, unit: 'percent' }]);
    expect(of('industry')).toHaveLength(9);
    expect(of('company_size')).toHaveLength(8);
  });

  it('names the missing field on a malformed file', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Análise da publicação');
    ws.addRow(['URL da publicação', 'https://linkedin.com/posts/x']);
    ws.addRow(['Data da publicação', '01/01/2026']);
    // no Impressões
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseExport(buf)).rejects.toThrow(XlsxShapeError);
    await expect(parseExport(buf)).rejects.toThrow(/Impressões/);
  });
});

describe('parseDuration hours token (phase-4 §5)', () => {
  it('parses "1 h 2 min 3 seg" as 3723 seconds', () => {
    expect(parseDuration('x', '1 h 2 min 3 seg')).toBe(3723);
  });
  it('parses "2 horas" as 7200 seconds', () => {
    expect(parseDuration('x', '2 horas')).toBe(7200);
  });
  it('still parses minute/second-only forms', () => {
    expect(parseDuration('x', '2 min 3 seg')).toBe(123);
    expect(parseDuration('x', '45 seg')).toBe(45);
  });
});
