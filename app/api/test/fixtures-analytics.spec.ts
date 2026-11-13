import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

const DIR = 'test/fixtures/synthetic-exports';
const FILES = ['aggregate.xlsx', 'single-post-video.xlsx', 'single-post-twin-a.xlsx', 'single-post-twin-b.xlsx', 'single-post-unlinked.xlsx', 'seed-post.xlsx'];

async function load(name: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const buf = await readFile(`${DIR}/${name}`);
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

function allCellText(wb: ExcelJS.Workbook): string[] {
  const out: string[] = [];
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => out.push(c.text)));
  return out;
}

function labelValue(wb: ExcelJS.Workbook, label: string): string | undefined {
  const ws = wb.worksheets[0]!;
  let found: string | undefined;
  ws.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: false }, (c, col) => { cells[col - 1] = c.text.trim(); });
    if (found === undefined && cells[0] === label) found = cells[1];
  });
  return found;
}

describe('analytics fixtures', () => {
  it('no fixture leaks the account holder name', async () => {
    for (const f of FILES) {
      const texts = allCellText(await load(f)).join('\n');
      expect(texts, f).not.toMatch(/kevin-shibuya/i);
      expect(texts, f).not.toMatch(/Kevin Shibuya/i);
    }
  });

  it('aggregate keeps the exact 5-sheet signature', async () => {
    const wb = await load('aggregate.xlsx');
    expect(wb.worksheets.map((w) => w.name)).toEqual(
      ['Descoberta', 'Engajamento', 'Publicações mais em alta', 'Seguidores', 'Dados demográficos'],
    );
  });

  it('single-post fixtures keep the 1-sheet signature and the generated values', async () => {
    for (const f of FILES.slice(1)) {
      expect((await load(f)).worksheets.map((w) => w.name), f).toEqual(['Análise da publicação']);
    }
    expect(labelValue(await load('single-post-twin-a.xlsx'), 'Impressões')).toBe('1200');
    expect(labelValue(await load('single-post-twin-b.xlsx'), 'Impressões')).toBe('1205');
    expect(labelValue(await load('single-post-video.xlsx'), 'Visualizações de vídeo')).toBe('120');
    expect(labelValue(await load('single-post-twin-a.xlsx'), 'Data da publicação')).toBe('02/07/2026');
  });

  it('twins share a URL; unlinked matches nothing and is distinguishable', async () => {
    const a = labelValue(await load('single-post-twin-a.xlsx'), 'URL da publicação');
    const b = labelValue(await load('single-post-twin-b.xlsx'), 'URL da publicação');
    expect(a).toBe(b);
    expect(a).toContain('-share-9990000000000000101-');
    const u = await load('single-post-unlinked.xlsx');
    expect(labelValue(u, 'URL da publicação')).toContain('-share-9990000000000000001-');
    expect(labelValue(u, 'Impressões')).toBe('111');
  });
});
