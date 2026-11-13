import type ExcelJS from 'exceljs';
import type { ParsedExport } from './export-types';
import { XlsxShapeError, loadWorkbook, parseSinglePost } from './xlsx-parser';
import { parseAggregate } from './aggregate-parser';

/** An aggregate export always carries these three; extra sheets are fine. */
const AGGREGATE_SIGNATURE = ['Engajamento', 'Seguidores', 'Dados demográficos'] as const;
/** A single-post export is exactly one sheet with this name. */
const SINGLE_POST_SHEET = 'Análise da publicação';

/**
 * Decides which export a workbook is by its sheet set. Anything unrecognised throws
 * with the sheet names it actually found — that message is the only clue an operator
 * gets when LinkedIn renames a tab.
 */
export function classifyWorkbook(wb: ExcelJS.Workbook): 'aggregate' | 'single_post' {
  const names = wb.worksheets.map((ws) => ws.name.trim());
  const present = new Set(names);

  if (AGGREGATE_SIGNATURE.every((name) => present.has(name))) return 'aggregate';
  if (names.length === 1 && present.has(SINGLE_POST_SHEET)) return 'single_post';

  throw new XlsxShapeError(`unrecognised sheets: ${names.map((n) => `"${n}"`).join(', ') || '(none)'}`);
}

/**
 * Parses either LinkedIn export type into canonical rows. Pure — no DB, no filesystem,
 * no URN extraction; post URLs pass through verbatim for the ingest layer to resolve.
 */
export async function parseExport(buffer: Buffer): Promise<ParsedExport> {
  const wb = await loadWorkbook(buffer);
  return classifyWorkbook(wb) === 'aggregate' ? parseAggregate(wb) : parseSinglePost(wb);
}
