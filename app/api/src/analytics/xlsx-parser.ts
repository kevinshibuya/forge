import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import type { AudienceDimension, AudienceRow, LifetimeMetricRow, ParsedSinglePost } from './export-types';

export class XlsxShapeError extends Error {
  constructor(detail: string) {
    super(`unexpected LinkedIn export shape: ${detail}`);
  }
}

export const ZONE = 'America/Sao_Paulo';

/** The pt-BR demographic category labels, in the canonical dimension vocabulary. */
export const AUDIENCE_DIMENSIONS: Record<string, AudienceDimension> = {
  Cargo: 'job_title',
  Localidade: 'location',
  'Nível de experiência': 'seniority',
  Empresa: 'company',
  Setor: 'industry',
  'Tamanho da empresa': 'company_size',
};

export function parsePercent(raw: string): number {
  if (/menos de 1/i.test(raw)) return 0.5;
  const n = Number(raw.replace('%', '').replace(',', '.').trim());
  if (Number.isNaN(n)) throw new XlsxShapeError(`unparseable percent "${raw}"`);
  return n;
}

/** First occurrence of a label wins — the export repeats "Reações" for sub-breakdowns. */
function firstValue(rows: string[][], label: string): string | undefined {
  const value = rows.find((r) => r[0] === label)?.[1];
  return value === '' ? undefined : value; // an empty value cell counts as missing
}

// ---------------------------------------------------------------------------
// Shared workbook primitives — used by every export parser in this folder.
// ---------------------------------------------------------------------------

export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs's .d.ts declares an ambient module-local `Buffer extends ArrayBuffer` stub
  // that shadows the real @types/node Buffer within its own module scope, so `load()`'s
  // parameter type structurally rejects a genuine Node Buffer. We can't name that private
  // stub type directly, so extract it via Parameters<> to cast across the boundary.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

/**
 * Reads a sheet into dense, trimmed, fixed-width string rows. Wholly empty rows are
 * dropped (exceljs skips them); rows that are blank only in some columns are kept,
 * which is what the side-by-side tables in the aggregate export rely on.
 */
export function sheetRows(ws: ExcelJS.Worksheet, width = 3): string[][] {
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => { cells[col - 1] = cell.text.trim(); });
    // normalize to a dense row (eachCell leaves holes for skipped columns)
    rows.push(Array.from({ length: width }, (_, i) => cells[i] ?? ''));
  });
  return rows;
}

/**
 * `dd/MM/yyyy` -> `YYYY-MM-DD`, or null when the cell is empty or malformed.
 * Calendar parts only — never round-trip these through `new Date('YYYY-MM-DD')`,
 * which would land a day early once rendered in America/Sao_Paulo.
 */
export function toIsoDate(raw: string): string | null {
  const dt = DateTime.fromFormat(raw.trim(), 'dd/MM/yyyy', { zone: ZONE });
  return dt.isValid ? dt.toFormat('yyyy-MM-dd') : null;
}

/**
 * Collects `Categoria | Valor | %` triples into canonical audience rows. Header rows
 * and any other non-dimension label fall through untouched. Deduped by
 * dimension+segment, first occurrence wins.
 */
export function collectAudience(rows: string[][]): AudienceRow[] {
  const out: AudienceRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const [label = '', segment = '', percent = ''] = row;
    const dimension = AUDIENCE_DIMENSIONS[label];
    if (!dimension || !segment || !percent) continue;
    const key = `${dimension}\x1f${segment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dimension, segment, value: parsePercent(percent), unit: 'percent' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canonical single-post export ("Análise da publicação")
// ---------------------------------------------------------------------------

interface LifetimeSpec {
  metric: string;
  /** Duration cells arrive as "20 min15 seg" / "10 seg"; everything else is an integer. */
  kind: 'int' | 'duration';
  /** Optional metrics are absent from perfectly healthy exports (e.g. video on a text post). */
  optional?: true;
}

/**
 * Label -> canonical metric. This registry is a FLOOR, not a whitelist of the sheet:
 * labels missing here are simply not emitted (section headers, the demographics
 * header, LinkedIn's future additions), while a missing REQUIRED label is a shape error.
 */
const LIFETIME_METRICS: Record<string, LifetimeSpec> = {
  'Impressões': { metric: 'impressions', kind: 'int' },
  'Usuários alcançados': { metric: 'members_reached', kind: 'int', optional: true },
  'Reações': { metric: 'reactions', kind: 'int' },
  'Comentários': { metric: 'comments', kind: 'int' },
  'Compartilhamentos': { metric: 'reposts', kind: 'int' },
  'Salvamentos': { metric: 'saves', kind: 'int' },
  // Optional despite being present in every fixture: both are 0 in all of them, so they
  // carry no information, and both are plausibly tied to account plan or post type.
  // Requiring them would hard-fail the drag-and-drop upload — the only ingest path the
  // UI offers — over a row the spec's registry never asked for.
  'Envios no LinkedIn': { metric: 'sends', kind: 'int', optional: true },
  'Engajamentos no botão Premium personalizado': {
    metric: 'premium_button_engagements', kind: 'int', optional: true,
  },
  'Visualizações do perfil a partir desta publicação': { metric: 'profile_views', kind: 'int', optional: true },
  'Seguidores obtidos com esta publicação': { metric: 'follows_gained', kind: 'int', optional: true },
  'Visualizações de vídeo': { metric: 'video_views', kind: 'int', optional: true },
  'Tempo de visualização': { metric: 'video_watch_time_seconds', kind: 'duration', optional: true },
  'Tempo médio de visualização': { metric: 'video_avg_watch_time_seconds', kind: 'duration', optional: true },
};

/** "20 min15 seg" -> 1215, "11 seg" -> 11, "1 h 2 min" -> 3720. All tokens are independently optional. */
export function parseDuration(label: string, raw: string): number {
  const hours = /(\d+)\s*h(?:ora)?s?\b/.exec(raw);
  const minutes = /(\d+)\s*min/.exec(raw);
  const seconds = /(\d+)\s*seg/.exec(raw);
  if (!hours && !minutes && !seconds) throw new XlsxShapeError(`"${label}" is not a duration: "${raw}"`);
  return (hours ? Number(hours[1]) * 3600 : 0)
    + (minutes ? Number(minutes[1]) * 60 : 0)
    + (seconds ? Number(seconds[1]) : 0);
}

function parseMetricCell(label: string, spec: LifetimeSpec, raw: string): number {
  if (spec.kind === 'duration') return parseDuration(label, raw);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new XlsxShapeError(`"${label}" is not an integer: "${raw}"`);
  return n;
}

/**
 * Parses an already-classified single-post workbook into canonical rows.
 * Row order is sheet order, which makes "first occurrence wins" fall out for free —
 * the sheet repeats "Reações" up to three times for its sub-breakdowns.
 */
export function parseSinglePost(wb: ExcelJS.Workbook): ParsedSinglePost {
  const ws = wb.worksheets[0];
  if (!ws) throw new XlsxShapeError('workbook has no sheets');
  const rows = sheetRows(ws);

  const postUrl = firstValue(rows, 'URL da publicação');
  if (!postUrl) throw new XlsxShapeError('missing "URL da publicação"');
  const date = firstValue(rows, 'Data da publicação');
  if (!date) throw new XlsxShapeError('missing "Data da publicação"');
  const time = firstValue(rows, 'Hora da publicação') ?? '00:00';
  const publishedAt = DateTime.fromFormat(`${date} ${time}`, 'dd/MM/yyyy HH:mm', { zone: ZONE }).toISO();
  if (publishedAt === null) throw new XlsxShapeError(`unparseable date/time "${date} ${time}"`);

  const lifetime: LifetimeMetricRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const [label = '', raw = ''] = row;
    const spec = LIFETIME_METRICS[label];
    // Unknown labels and section headers (label present, value cell empty) are not metrics.
    if (!spec || !raw || seen.has(spec.metric)) continue;
    seen.add(spec.metric);
    lifetime.push({ metric: spec.metric, value: parseMetricCell(label, spec, raw) });
  }

  const missing = Object.entries(LIFETIME_METRICS)
    .filter(([, spec]) => !spec.optional && !seen.has(spec.metric))
    .map(([label]) => `"${label}"`);
  if (missing.length > 0) throw new XlsxShapeError(`missing ${missing.join(', ')}`);

  return {
    kind: 'single_post',
    postUrl,
    publishedAt,
    lifetime,
    audience: collectAudience(rows),
  };
}
