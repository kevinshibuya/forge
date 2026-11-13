#!/usr/bin/env node
// Builds the committed LinkedIn analytics fixtures under test/fixtures/synthetic-exports/.
//
//   node scripts/make-synthetic-exports.mjs        (from app/api, Node 22 or later)
//
// Every value here is invented. The workbooks copy only the SHAPE of LinkedIn's pt-BR
// exports: sheet names, row labels, section headers, the repeated "Reações" sub-rows,
// the side-by-side top-posts tables and the "menos de 1%" percent convention. The tests
// that read these files assert on the numbers below, so a change here is a change there.
//
// No dependencies: the script writes the OOXML parts and the zip container itself, with a
// fixed timestamp, so a re-run produces byte-identical files.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const OUT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../test/fixtures/synthetic-exports');

// ---------------------------------------------------------------------------
// Synthetic posts
// ---------------------------------------------------------------------------

const POST = (handle, slug, kind, id, suffix) =>
  `https://www.linkedin.com/posts/${handle}_${slug}-${kind}-${id}-${suffix}`;

/** The seed post and the twin share one share id under two handles, as the real pair did. */
export const SEED_URL = POST('seed-example', 'synthetic-twin-post', 'share', '9990000000000000101', 'AAAA');
export const TWIN_URL = POST('user-example', 'synthetic-twin-post', 'share', '9990000000000000101', 'AAAA');
export const VIDEO_URL = POST('user-example', 'synthetic-video-post', 'ugcPost', '9990000000000000102', 'BBBB');
export const UNLINKED_URL = POST('user-example', 'unlinked-post', 'share', '9990000000000000001', 'XXXX');
const POST_A_URL = POST('user-example', 'synthetic-post-a', 'share', '9990000000000000103', 'CCCC');

// ---------------------------------------------------------------------------
// Single-post export ("Análise da publicação")
// ---------------------------------------------------------------------------

const BOLD = 1;
const CENTER = 2;

/** One single-post workbook. `video` adds the video block; `audience` is [category, segment, percent][]. */
function singlePost({ url, date, time, impressions, reached, video, profileViews, follows, reactions, comments, audience }) {
  const rows = [
    [['URL da publicação', BOLD], url],
    [['Data da publicação', BOLD], date],
    [['Hora da publicação', BOLD], time],
    null,
    [[video ? 'Descoberta' : 'Desempenho da publicação', BOLD]],
    ['Impressões', String(impressions)],
    ['Usuários alcançados', String(reached)],
  ];
  if (video) {
    rows.push(
      [['Desempenho do vídeo', BOLD]],
      ['Visualizações de vídeo', String(video.views)],
      ['Tempo de visualização', video.watchTime],
      ['Tempo médio de visualização', video.avgWatchTime],
    );
  }
  rows.push(
    [['Atividades do perfil', BOLD]],
    ['Visualizações do perfil a partir desta publicação', String(profileViews)],
    ['Seguidores obtidos com esta publicação', String(follows)],
    [['Engajamento', BOLD]],
    // The export repeats "Reações": the total first, then two sub-breakdowns. First wins.
    ['Reações', String(reactions)],
    ['Reações', String(reactions - 7)],
    ['Comentários', String(comments)],
    ['Compartilhamentos', '0'],
    ['Salvamentos', '0'],
    ['Envios no LinkedIn', '0'],
    ['Reações', '0'],
    ['Engajamentos no botão Premium personalizado', '0'],
    null,
    [['Dados demográficos de quem viu a publicação', BOLD]],
    [['Categoria', CENTER], ['Valor', CENTER], ['%', CENTER]],
    ...audience,
  );
  return [{ name: 'Análise da publicação', rows }];
}

const SEED_AUDIENCE = [
  ['Cargo', 'Engenheiro de software', '4%'],
  ['Cargo', 'Desenvolvedor full stack', '2%'],
  ['Localidade', 'São Paulo e Região', '6%'],
  ['Localidade', 'Porto Alegre e Região', '3%'],
  ['Localidade', 'Curitiba e Região', '2%'],
  ['Localidade', 'Belo Horizonte e Região', '2%'],
  ['Localidade', 'Lisboa e Região', '2%'],
  ['Localidade', 'Madri e Região', '1%'],
  ['Localidade', 'Berlim e Região', '1%'],
  ['Localidade', 'Toronto e Região', '1%'],
  ['Localidade', 'Londres e Região, Reino Unido', 'menos de 1%'],
  ['Nível de experiência', 'Iniciante', '20%'],
  ['Nível de experiência', 'Sênior', '9%'],
  ['Nível de experiência', 'Gerente', '3%'],
  ['Nível de experiência', 'Treinamento', '1%'],
  ['Empresa', 'Empresa Exemplo Ltda', 'menos de 1%'],
  ['Setor', 'Desenvolvimento de software', '7%'],
  ['Setor', 'Atividades dos serviços de tecnologia da informação', '5%'],
  ['Setor', 'Tecnologia, Informação e Internet', '3%'],
  ['Setor', 'Atividades de serviços financeiros', '2%'],
  ['Setor', 'Educação', '2%'],
  ['Setor', 'Construção', '1%'],
  ['Setor', 'Varejo', '1%'],
  ['Setor', 'Transporte, armazenagem e correio', 'menos de 1%'],
  ['Setor', 'Jogos para computador', 'menos de 1%'],
  ['Tamanho da empresa', 'Mais de 10.001 funcionários', '7%'],
  ['Tamanho da empresa', '1.001 a 5.000 funcionários', '5%'],
  ['Tamanho da empresa', '501 a 1.000 funcionários', '4%'],
  ['Tamanho da empresa', '11 a 50 funcionários', '4%'],
  ['Tamanho da empresa', '51 a 200 funcionários', '3%'],
  ['Tamanho da empresa', '2 a 10 funcionários', '2%'],
  ['Tamanho da empresa', '201 a 500 funcionários', '2%'],
  ['Tamanho da empresa', '5.001 a 10.000 funcionários', '1%'],
];

const TWIN_AUDIENCE = [
  ['Cargo', 'Engenheiro de software', '4%'],
  ['Cargo', 'Desenvolvedor full stack', '2%'],
  ['Cargo', 'Desenvolvedor de front-end', 'menos de 1%'],
  ...SEED_AUDIENCE.slice(2),
];

const VIDEO_AUDIENCE = [
  ['Localidade', 'São Paulo e Região', '35%'],
  ['Localidade', 'Porto Alegre e Região', '12%'],
  ['Nível de experiência', 'Iniciante', '48%'],
  ['Nível de experiência', 'Sênior', '25%'],
  ['Empresa', 'Empresa Exemplo Ltda', '6%'],
  ['Setor', 'Desenvolvimento de software', '22%'],
  ['Setor', 'Atividades dos serviços de tecnologia da informação', '17%'],
  ['Setor', 'Atividades de serviços financeiros', '5%'],
  ['Tamanho da empresa', '51 a 200 funcionários', '19%'],
  ['Tamanho da empresa', '1.001 a 5.000 funcionários', '15%'],
  ['Tamanho da empresa', 'Mais de 10.001 funcionários', '14%'],
  ['Tamanho da empresa', '11 a 50 funcionários', '11%'],
];

const TWIN_BASE = {
  url: TWIN_URL, date: '02/07/2026', time: '11:00', reached: 700, profileViews: 3, follows: 4,
  reactions: 22, comments: 7, audience: TWIN_AUDIENCE,
};

const SINGLE_POSTS = {
  'seed-post.xlsx': singlePost({
    url: SEED_URL, date: '02/07/2026', time: '11:00', impressions: 1000, reached: 600,
    profileViews: 3, follows: 4, reactions: 20, comments: 6, audience: SEED_AUDIENCE,
  }),
  'single-post-twin-a.xlsx': singlePost({ ...TWIN_BASE, impressions: 1200 }),
  'single-post-twin-b.xlsx': singlePost({ ...TWIN_BASE, impressions: 1205, reached: 702 }),
  'single-post-unlinked.xlsx': singlePost({ ...TWIN_BASE, url: UNLINKED_URL, impressions: 111 }),
  'single-post-video.xlsx': singlePost({
    url: VIDEO_URL, date: '02/06/2026', time: '08:30', impressions: 500, reached: 200,
    video: { views: 120, watchTime: '20 min15 seg', avgWatchTime: '10 seg' },
    profileViews: 3, follows: 1, reactions: 15, comments: 2, audience: VIDEO_AUDIENCE,
  }),
};

// ---------------------------------------------------------------------------
// Aggregate export: five sheets over a 90-day window
// ---------------------------------------------------------------------------

const WINDOW_START = Date.UTC(2026, 4, 11); // 11/05/2026
const DAYS = 90; // through 08/08/2026
const ddmmyyyy = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};
const day = (i) => ddmmyyyy(WINDOW_START + i * 86_400_000);

/** Six quiet days, then a deterministic saw-tooth. Day 6 (17/05) is 42, day 7 (18/05) is 79. */
const dailyImpressions = (i) => (i < 6 ? 0 : (i * 37) % 90);
const dailyEngagements = (i) => Math.floor(dailyImpressions(i) / 15);
/** One new follower every ninth day, starting on day 5 (16/05). */
const dailyFollowers = (i) => (i % 9 === 5 ? 1 : 0);

const ENGAGEMENT_TABLE = [
  [POST_A_URL, '17/05/2026', '30'],
  [TWIN_URL, '02/07/2026', '28'],
  [VIDEO_URL, '02/06/2026', '18'],
];
const OLDER = Array.from({ length: 11 }, (_, i) => [
  POST('user-example', `synthetic-older-post-${i + 1}`, i % 2 ? 'ugcPost' : 'share', String(9990000000000000201n + BigInt(i)), 'DDDD'),
  ddmmyyyy(Date.UTC(2022, i, 3 + i)),
  String(60 - i * 5),
]);
const IMPRESSIONS_TABLE = [
  [TWIN_URL, '02/07/2026', '1200'],
  [POST_A_URL, '17/05/2026', '900'],
  [VIDEO_URL, '02/06/2026', '500'],
  ...OLDER,
];

const ACCOUNT_AUDIENCE = [
  ['Empresa', 'Empresa Exemplo A', '3%'],
  ['Empresa', 'Empresa Exemplo B', '2%'],
  ['Empresa', 'Empresa Exemplo C', '2%'],
  ['Localidade', 'São Paulo e Região', '38%'],
  ['Localidade', 'Porto Alegre e Região', '8%'],
  ['Localidade', 'Curitiba e Região', '5%'],
  ['Localidade', 'Lisboa e Região', '4%'],
  ['Localidade', 'Rio de Janeiro e Região', '3%'],
  ['Localidade', 'Belo Horizonte e Região', '2%'],
  ['Tamanho da empresa', '51 a 200 funcionários', '14%'],
  ['Tamanho da empresa', '1.001 a 5.000 funcionários', '13%'],
  ['Tamanho da empresa', '11 a 50 funcionários', '10%'],
  ['Tamanho da empresa', 'Mais de 10.001 funcionários', '8%'],
  ['Tamanho da empresa', '2 a 10 funcionários', '8%'],
  ['Tamanho da empresa', '501 a 1.000 funcionários', '6%'],
  ['Tamanho da empresa', '201 a 500 funcionários', '5%'],
  ['Tamanho da empresa', '5.001 a 10.000 funcionários', '3%'],
  ['Tamanho da empresa', '0 a 1 funcionários', '2%'],
  ['Nível de experiência', 'Sênior', '36%'],
  ['Nível de experiência', 'Iniciante', '31%'],
  ['Nível de experiência', 'Gerente', '5%'],
  ['Nível de experiência', 'Diretor', '3%'],
  ['Nível de experiência', 'Dirigente (CEO, COO, CFO, CMO)', '2%'],
  ['Nível de experiência', 'Proprietário', '2%'],
  ['Nível de experiência', 'Vice-Presidente', '1%'],
  ['Cargo', 'Engenheiro de software', '8%'],
  ['Cargo', 'Desenvolvedor full stack', '4%'],
  ['Cargo', 'Desenvolvedor de front-end', '3%'],
  ['Cargo', 'Gerente de produto', '2%'],
  ['Cargo', 'Proprietário', '2%'],
  ['Cargo', 'CEO', '1%'],
  ['Cargo', 'Desenvolvedor web', '1%'],
  ['Setor', 'Atividades dos serviços de tecnologia da informação', '16%'],
  ['Setor', 'Desenvolvimento de software', '13%'],
  ['Setor', 'Tecnologia, Informação e Internet', '7%'],
  ['Setor', 'Atividades de serviços financeiros', '5%'],
  ['Setor', 'Hospitais e atividades de atenção à saúde humana', '4%'],
  ['Setor', 'Recrutamento e seleção de pessoal', '4%'],
  ['Setor', 'Fornecimento e gestão de recursos humanos', '3%'],
  ['Setor', 'Serviços de gestão estratégica', '3%'],
  ['Setor', 'Varejo', '2%'],
  ['Setor', 'Educação superior', '2%'],
];

const topPostRows = () => {
  const rows = [[['Máximo de 50 publicações disponíveis para inclusão nesta lista', CENTER]], null];
  rows.push([
    ['URL da publicação', BOLD], ['Data de publicação', BOLD], ['Engajamentos', BOLD], '',
    ['URL da publicação', BOLD], ['Data de publicação', BOLD], ['Impressões', BOLD],
  ]);
  for (let i = 0; i < IMPRESSIONS_TABLE.length; i++) {
    const left = ENGAGEMENT_TABLE[i] ?? ['', '', ''];
    rows.push([...left, '', ...IMPRESSIONS_TABLE[i]]);
  }
  return rows;
};

const AGGREGATE = [
  {
    name: 'Descoberta',
    rows: [
      [['Desempenho geral', BOLD], `${day(0)} - ${day(DAYS - 1)}`],
      ['Impressões', '2400'],
      ['Usuários alcançados', '1100'],
    ],
  },
  {
    name: 'Engajamento',
    rows: [
      [['Data', BOLD], ['Impressões', BOLD], ['Engajamentos', BOLD]],
      ...Array.from({ length: DAYS }, (_, i) => [day(i), String(dailyImpressions(i)), String(dailyEngagements(i))]),
    ],
  },
  { name: 'Publicações mais em alta', rows: topPostRows() },
  {
    name: 'Seguidores',
    rows: [
      [[`Total de seguidores em ${day(DAYS - 1)}`, BOLD], '500'],
      null,
      [['Data', BOLD], ['Novos seguidores', BOLD]],
      ...Array.from({ length: DAYS }, (_, i) => [day(i), String(dailyFollowers(i))]),
    ],
  },
  {
    name: 'Dados demográficos',
    rows: [[['Principais dados demográficos', BOLD], ['Valor', BOLD], ['Porcentagem', BOLD]], ...ACCOUNT_AUDIENCE],
  },
];

// ---------------------------------------------------------------------------
// OOXML writer: shared strings, one style table, string cells only (as LinkedIn writes them)
// ---------------------------------------------------------------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const col = (i) => String.fromCharCode(65 + i);

const STYLES = `${XML}<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function workbookParts(sheets) {
  const strings = [];
  const index = new Map();
  const sst = (s) => {
    if (!index.has(s)) { index.set(s, strings.length); strings.push(s); }
    return index.get(s);
  };

  const sheetXml = sheets.map(({ rows }) => {
    const out = [];
    rows.forEach((row, r) => {
      if (!row) return; // a wholly empty row is absent from the file, as in the real export
      const cells = row.map((c, i) => {
        const [text, style] = Array.isArray(c) ? c : [c, 0];
        if (text === undefined) return '';
        return `<c r="${col(i)}${r + 1}"${style ? ` s="${style}"` : ''} t="s"><v>${sst(text)}</v></c>`;
      });
      out.push(`<row r="${r + 1}">${cells.join('')}</row>`);
    });
    return `${XML}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetData>${out.join('')}</sheetData></worksheet>`;
  });

  const parts = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/app.xml': `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>forge synthetic fixtures</Application></Properties>`,
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>forge synthetic fixtures</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 3}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>${sheets.map((_, i) => `<Relationship Id="rId${i + 3}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    'xl/styles.xml': STYLES,
  };
  sheetXml.forEach((xml, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = xml; });
  parts['xl/sharedStrings.xml'] = `${XML}<sst xmlns="${NS_MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  return parts;
}

// ---------------------------------------------------------------------------
// Zip container (deflate, UTF-8 names, fixed 2026-01-01 00:00 timestamp)
// ---------------------------------------------------------------------------

const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zip(parts) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = { 'aggregate.xlsx': AGGREGATE, ...SINGLE_POSTS };
  for (const [name, sheets] of Object.entries(files)) {
    const out = path.join(OUT_DIR, name);
    await writeFile(out, zip(workbookParts(sheets)));
    console.log(`wrote ${path.relative(process.cwd(), out)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await main();
}
