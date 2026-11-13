import type ExcelJS from 'exceljs';
import type {
  DimPostSeed,
  ParsedAggregate,
  ProfileMetric,
  ProfileMetricRow,
  WindowMetric,
  WindowMetricRow,
} from './export-types';
import { XlsxShapeError, collectAudience, sheetRows, toIsoDate } from './xlsx-parser';

const SHEETS = {
  discovery: 'Descoberta',
  engagement: 'Engajamento',
  topPosts: 'Publicações mais em alta',
  followers: 'Seguidores',
  demographics: 'Dados demográficos',
} as const;

/** `11/05/2026 - 08/08/2026` — the window the whole export is scoped to. */
const PERIOD_RE = /^(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})$/;
/** The Seguidores sheet carries its snapshot date IN THE LABEL, not in a date column. */
const FOLLOWERS_TOTAL_RE = /^Total de seguidores em\s+(\d{2}\/\d{2}\/\d{4})$/;

/** Column headers of the daily engagement table. */
const DAILY_PROFILE_METRICS: Record<string, ProfileMetric> = {
  'Impressões': 'impressions',
  'Engajamentos': 'engagements',
};

/** Row labels on Descoberta and the third column header of each top-posts table. */
const WINDOW_METRICS: Record<string, WindowMetric> = {
  'Impressões': 'impressions',
  'Usuários alcançados': 'members_reached',
  'Engajamentos': 'engagements',
};

const DATE_HEADER = 'Data';
const POST_URL_HEADER = 'URL da publicação';
const POST_DATE_HEADER = 'Data de publicação';

/** Dense rows still index as `string | undefined` under noUncheckedIndexedAccess. */
function cell(row: string[], index: number): string {
  return row[index] ?? '';
}

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.worksheets.find((w) => w.name.trim() === name);
  if (!ws) throw new XlsxShapeError(`missing sheet "${name}"`);
  return ws;
}

function requireNumber(context: string, raw: string): number {
  const n = Number(raw);
  if (raw === '' || Number.isNaN(n)) throw new XlsxShapeError(`${context} is not a number: "${raw}"`);
  return n;
}

function requireDate(context: string, raw: string): string {
  const iso = toIsoDate(raw);
  if (iso === null) throw new XlsxShapeError(`${context} is not a dd/MM/yyyy date: "${raw}"`);
  return iso;
}

/** Window bounds + the two account-level totals. Bounds are required: everything downstream is scoped to them. */
function parseDiscovery(wb: ExcelJS.Workbook): { window: { start: string; end: string }; metrics: WindowMetricRow[] } {
  const rows = sheetRows(sheet(wb, SHEETS.discovery));

  const period = rows.flat().map((text) => PERIOD_RE.exec(text)).find((m): m is RegExpExecArray => m !== null);
  if (!period) throw new XlsxShapeError(`"${SHEETS.discovery}" has no "dd/MM/yyyy - dd/MM/yyyy" period`);

  const metrics: WindowMetricRow[] = [];
  const seen = new Set<WindowMetric>();
  for (const row of rows) {
    const [label = '', raw = ''] = row;
    const metric = WINDOW_METRICS[label];
    if (!metric || !raw || seen.has(metric)) continue;
    seen.add(metric);
    metrics.push({ url: null, metric, value: requireNumber(`"${label}"`, raw) });
  }

  return {
    window: {
      start: requireDate('window start', period[1] ?? ''),
      end: requireDate('window end', period[2] ?? ''),
    },
    metrics,
  };
}

/** One row per day per column metric, zero days included. */
function parseDailyEngagement(wb: ExcelJS.Workbook): ProfileMetricRow[] {
  const rows = sheetRows(sheet(wb, SHEETS.engagement));
  const headerIndex = rows.findIndex((r) => cell(r, 0) === DATE_HEADER);
  const header = rows[headerIndex];
  if (!header) throw new XlsxShapeError(`"${SHEETS.engagement}" has no "${DATE_HEADER}" header row`);

  // Read the metrics off the header so a column reorder can't silently swap them.
  const columns = header
    .map((label, index) => ({ index, metric: DAILY_PROFILE_METRICS[label] }))
    .filter((c): c is { index: number; metric: ProfileMetric } => c.metric !== undefined);
  if (columns.length === 0) throw new XlsxShapeError(`"${SHEETS.engagement}" has no recognised metric columns`);

  const out: ProfileMetricRow[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (!cell(row, 0)) continue;
    const date = requireDate(`"${SHEETS.engagement}" date`, cell(row, 0));
    for (const { index, metric } of columns) {
      out.push({ metric, date, value: requireNumber(`"${SHEETS.engagement}" ${metric} on ${date}`, cell(row, index)) });
    }
  }
  return out;
}

/** The running total (dated by its own label) plus one new-followers row per day, zeros included. */
function parseFollowers(wb: ExcelJS.Workbook): ProfileMetricRow[] {
  const rows = sheetRows(sheet(wb, SHEETS.followers));
  const out: ProfileMetricRow[] = [];

  const totalRow = rows.find((r) => FOLLOWERS_TOTAL_RE.test(cell(r, 0)));
  if (!totalRow) throw new XlsxShapeError(`"${SHEETS.followers}" has no "Total de seguidores em <dd/MM/yyyy>" row`);
  out.push({
    metric: 'followers_total',
    date: requireDate('followers total date', FOLLOWERS_TOTAL_RE.exec(cell(totalRow, 0))?.[1] ?? ''),
    value: requireNumber('followers total', cell(totalRow, 1)),
  });

  const headerIndex = rows.findIndex((r) => cell(r, 0) === DATE_HEADER);
  if (headerIndex === -1) throw new XlsxShapeError(`"${SHEETS.followers}" has no "${DATE_HEADER}" header row`);
  for (const row of rows.slice(headerIndex + 1)) {
    if (!cell(row, 0)) continue;
    const date = requireDate(`"${SHEETS.followers}" date`, cell(row, 0));
    out.push({ metric: 'followers_new', date, value: requireNumber(`new followers on ${date}`, cell(row, 1)) });
  }
  return out;
}

/**
 * Two side-by-side tables (cols A-C, then E-G), each `URL | Data de publicação | <metric>`,
 * blank-padded down to the taller one. The metric comes from the third header cell, so the
 * left/right order of the tables is not load-bearing.
 */
function parseTopPosts(wb: ExcelJS.Workbook): { metrics: WindowMetricRow[]; dimPosts: DimPostSeed[] } {
  const ws = wb.worksheets.find((w) => w.name.trim() === SHEETS.topPosts);
  const metrics: WindowMetricRow[] = [];
  const dimPosts: DimPostSeed[] = [];
  if (!ws) return { metrics, dimPosts }; // an export with no ranked posts simply seeds none

  const rows = sheetRows(ws, 7);
  const seenMetrics = new Set<string>();
  const seenPosts = new Set<string>();

  for (const first of [0, 4]) {
    const headerIndex = rows.findIndex((r) => cell(r, first) === POST_URL_HEADER);
    const header = rows[headerIndex];
    if (!header) continue;
    const metricLabel = cell(header, first + 2);
    const metric = WINDOW_METRICS[metricLabel];
    if (!metric) throw new XlsxShapeError(`"${SHEETS.topPosts}" has an unknown metric column "${metricLabel}"`);
    if (cell(header, first + 1) !== POST_DATE_HEADER) {
      throw new XlsxShapeError(
        `"${SHEETS.topPosts}" expected "${POST_DATE_HEADER}", got "${cell(header, first + 1)}"`,
      );
    }

    for (const row of rows.slice(headerIndex + 1)) {
      const url = cell(row, first);
      if (!url) continue; // blank padding under the shorter table
      const key = `${url} ${metric}`;
      if (!seenMetrics.has(key)) {
        seenMetrics.add(key);
        metrics.push({
          url,
          metric,
          value: requireNumber(`"${SHEETS.topPosts}" ${metric} for ${url}`, cell(row, first + 2)),
        });
      }
      if (!seenPosts.has(url)) {
        seenPosts.add(url);
        dimPosts.push({ url, publishedAt: toIsoDate(cell(row, first + 1)) });
      }
    }
  }

  return { metrics, dimPosts };
}

/**
 * Parses an already-classified aggregate workbook into canonical rows. Pure: no DB, no
 * filesystem, no URN extraction — URLs pass through exactly as the export wrote them.
 */
export function parseAggregate(wb: ExcelJS.Workbook): ParsedAggregate {
  const discovery = parseDiscovery(wb);
  const topPosts = parseTopPosts(wb);

  return {
    kind: 'aggregate',
    window: discovery.window,
    profile: [...parseDailyEngagement(wb), ...parseFollowers(wb)],
    windowMetrics: [...discovery.metrics, ...topPosts.metrics],
    dimPosts: topPosts.dimPosts,
    audience: collectAudience(sheetRows(sheet(wb, SHEETS.demographics))),
  };
}
