// Headless route smoke + planner date-correctness probe. Run from app/api:
//   node scripts/route-smoke.mjs
//   WEB_URL=http://localhost:5174 node scripts/route-smoke.mjs
// Vite pins no port, so forge takes 5173 only when nothing else has it — set WEB_URL when
// another dev server (the portfolio, typically) already owns it.
// Mutates ONLY post #5 (sacrificial by standing rule) and restores it.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import postgres from 'postgres';

// Normalised: a WEB_URL copied from a Vite banner usually ends in "/", and `WEB + '/backlog'`
// would then probe `//backlog` — a path the router never matches, while Vite still answers with
// the SPA shell, so every route would print ok against a page that rendered no-match.
const WEB = (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const API = 'http://localhost:3001/api';
const ROUTES = ['/', '/backlog', '/planner', '/posts', '/posts/5', '/analytics', '/analytics/1', '/playbook', '/runs', '/settings'];

const iso = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
const target = new Date(Date.now() + 2 * 86400_000);
const targetDate = iso(target);

const res = await fetch(`${API}/posts/5`);
if (!res.ok) { console.error(`post #5 not reachable (${res.status}) — cannot run planner probe`); process.exit(1); }
const before = (await res.json()).post; // GET /posts/:id returns the detail envelope { post, revisions, latestDraft }
if (!before) { console.error('detail envelope had no .post — API shape changed?'); process.exit(1); }

const put = async (body) => {
  const r = await fetch(`${API}/posts/5/schedule`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) { console.error(`schedule PATCH failed: ${r.status} ${await r.text()}`); process.exit(1); }
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));

// Guard: another app on the port renders a non-empty #root too, so every route probe
// passes against the wrong app and only app-specific assertions fail — which reads
// exactly like a forge regression. Abort instead.
await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
const pageTitle = await page.title();
if (!/forge/i.test(pageTitle)) {
  console.error(`FAIL: ${WEB} is serving "${pageTitle}" — not forge. Set WEB_URL to forge's port; aborting.`);
  await browser.close(); process.exit(1);
}

let failed = false;
try {
  await put({ date: targetDate, time: '10:30' });
  for (const route of ROUTES) {
    await page.goto(WEB + route, { waitUntil: 'networkidle' });
    const kids = await page.evaluate(() => document.getElementById('root')?.children.length ?? 0);
    if (kids === 0) { console.error(`FAIL ${route}: #root empty`); failed = true; }
    else console.log(`ok ${route}`);
  }
  // date-correctness: the chip for post #5 renders inside the lane for targetDate
  await page.goto(`${WEB}/planner?date=${targetDate}`, { waitUntil: 'networkidle' });
  const inLane = await page.evaluate(
    (d) => !!document.querySelector(`[data-day="${d}"] [data-post-id="5"]`), targetDate,
  );
  if (!inLane) { console.error(`FAIL planner: post #5 chip not in lane [data-day="${targetDate}"]`); failed = true; }
  else console.log(`ok planner date placement (${targetDate})`);

  // import probe: ingest the unlinked fixture through POST /analytics/import, then
  // delete every DB row it created so the next run re-ingests instead of deduping.
  // Touches no real post, no post status, and not the settings row — the fixture's
  // URL matches no app post by design. The archived raw file is deliberately kept:
  // the sha256 dedupe lookup is DB-based, so dropping the rows restores re-runnability.
  const IMPORT_FIXTURE = new URL('../test/fixtures/synthetic-exports/single-post-unlinked.xlsx', import.meta.url);
  const UNLINKED_URN = 'urn:li:share:9990000000000000001';
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge');
  let sourceFileId = null;
  try {
    const form = new FormData();
    form.append('file', new Blob([await readFile(IMPORT_FIXTURE)]), 'single-post-unlinked.xlsx');
    const r = await fetch(`${API}/analytics/import`, { method: 'POST', body: form });
    const body = await r.json().catch(() => null);
    sourceFileId = typeof body?.sourceFileId === 'number' ? body.sourceFileId : null;

    const misses = [];
    if (r.status !== 201) misses.push(`expected HTTP 201, got ${r.status}`);
    if (!body) misses.push('response body was not JSON');
    else {
      if (!('linkedPostId' in body) || body.linkedPostId !== null) misses.push(`linkedPostId expected null, got ${JSON.stringify(body.linkedPostId)}`);
      if (!Array.isArray(body.warnings) || body.warnings.length < 1) misses.push(`expected >=1 warning, got ${JSON.stringify(body.warnings)}`);
      if (!(body.factCounts?.lifetime > 0)) misses.push(`factCounts.lifetime expected > 0, got ${JSON.stringify(body.factCounts?.lifetime)}`);
      if (body.alreadyImported) misses.push('alreadyImported — a previous run left rows behind');
    }
    if (misses.length) { console.error(`FAIL import-probe: ${misses.join('; ')}`); failed = true; }
    else console.log('ok import-probe');
  } finally {
    if (sourceFileId !== null) {
      for (const table of ['fact_post_lifetime', 'fact_window_metric', 'fact_audience_segment', 'fact_profile_metric']) {
        await sql`delete from ${sql(table)} where source_file_id = ${sourceFileId}`;
      }
      await sql`delete from dim_post where post_urn = ${UNLINKED_URN}`;
      await sql`delete from source_files where id = ${sourceFileId}`;
    }
    await sql.end();
  }

  // S3 probes: theme toggle + sidebar collapse (phase 3)
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await page.click('[data-probe="theme-toggle"]');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== 'dark' && theme !== 'light') { console.error('FAIL theme: data-theme not set after toggle'); failed = true; }
  await page.reload({ waitUntil: 'networkidle' });
  const theme2 = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme2 !== theme) { console.error('FAIL theme: not persisted across reload'); failed = true; }
  else console.log(`ok theme toggle + persistence (${theme})`);

  // The rail's width is ANIMATED (a ~240ms transition), so reading it the instant after the
  // click samples a mid-flight value. Wait for the width to SETTLE inside the collapsed band,
  // then read it — the assertion below is unchanged and still owns the verdict. A rail that
  // never collapses simply exhausts the wait and fails on the real, settled-enough number.
  const settledRailWidth = async () => {
    await page
      .waitForFunction(() => {
        const w = document.querySelector('aside')?.getBoundingClientRect().width ?? 0;
        return w > 0 && w <= 100;
      }, null, { timeout: 3000, polling: 'raf' })
      .catch(() => {}); // swallow the timeout so the assertion reports the actual width
    return page.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().width ?? 0);
  };

  await page.click('[data-probe="sidebar-collapse"]');
  const railW = await settledRailWidth();
  if (railW === 0 || railW > 100) { console.error(`FAIL sidebar: collapsed width ${railW}`); failed = true; }
  await page.reload({ waitUntil: 'networkidle' });
  // Post-reload the rail paints collapsed with no transition to run, but the same wait costs
  // nothing when it is already true and keeps the two reads honest under any future easing.
  const railW2 = await settledRailWidth();
  if (railW2 === 0 || railW2 > 100) { console.error(`FAIL sidebar: collapse not persisted (width ${railW2})`); failed = true; }
  else console.log('ok sidebar collapse + persistence');
  // restore defaults so reruns start clean
  await page.evaluate(() => { localStorage.removeItem('forge:theme'); localStorage.removeItem('forge:sidebar'); });
  await page.reload({ waitUntil: 'networkidle' });

  // S6 probes: Overview hero (data-independent: bars XOR empty state) + window pill request
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  const hero = await page.evaluate(() => ({
    bars: !!document.querySelector('[data-probe="diverging-bars"]'),
    empty: !!document.querySelector('[data-probe="hero-empty"]'),
    cards: document.querySelectorAll('[data-probe="hero-stat-card"]').length,
  }));
  if (!(hero.bars || hero.empty)) { console.error('FAIL overview: neither diverging bars nor the empty state rendered'); failed = true; }
  if (hero.cards !== 4) { console.error(`FAIL overview: expected 4 hero stat cards, got ${hero.cards}`); failed = true; }
  else console.log(`ok overview hero (${hero.bars ? 'data' : 'empty state'})`);

  // NOTE: the settled handler is attached at creation, NOT after the click. If it is
  // attached afterwards, a failing run rejects this 5s timeout while the click is still
  // blocked on its 30s selector wait — an unhandled rejection kills the process before
  // the finally below restores post #5. Keep this ordering.
  const sawRequest = page
    .waitForRequest((r) => r.url().includes('/analytics/overview?window=7'), { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  await page.click('[data-probe="window-7"]').catch(() => {});
  if (await sawRequest) console.log('ok window pill fires overview request');
  else { console.error('FAIL window pill: no /analytics/overview?window=7 request observed'); failed = true; }

  // S4 probes: analytics band 1 — range pills, import pill, chart XOR empty, tab swap, range refetch
  await page.goto(WEB + '/analytics', { waitUntil: 'networkidle' });
  const band1 = await page.evaluate(() => ({
    pills: ['7', '28', '90', 'all'].filter((r) => document.querySelector(`[data-probe="range-${r}"]`)).length,
    importPill: !!document.querySelector('[data-probe="import-pill"]'),
    chart: !!document.querySelector('[data-probe="metric-chart"]'),
    empty: !!document.querySelector('[data-probe="band1-empty"]'),
  }));
  if (band1.pills !== 4) { console.error(`FAIL analytics: expected 4 range pills, found ${band1.pills}`); failed = true; }
  if (!band1.importPill) { console.error('FAIL analytics: import pill missing'); failed = true; }
  if (!(band1.chart || band1.empty)) { console.error('FAIL analytics: neither chart nor band-1 empty state'); failed = true; }
  else console.log(`ok analytics band 1 (${band1.chart ? 'chart' : 'empty state'})`);

  const sawAll = page
    .waitForRequest((r) => r.url().includes('/analytics/board?range=all'), { timeout: 5000 })
    .then(() => true).catch(() => false);
  await page.click('[data-probe="range-all"]').catch(() => {});
  if (await sawAll) console.log('ok range pill fires board request');
  else { console.error('FAIL analytics: no /analytics/board?range=all request observed'); failed = true; }

  // with range=all the imported window is guaranteed present → the chart must exist and tabs must swap it
  await page.waitForSelector('[data-probe="metric-chart"]', { timeout: 5000 }).catch(() => {});
  const beforeMetric = await page.evaluate(() => document.querySelector('[data-probe="metric-chart"]')?.getAttribute('data-metric') ?? null);
  await page.click('[data-probe="kpi-tab-engagements"]').catch(() => {});
  const afterMetric = await page.evaluate(() => document.querySelector('[data-probe="metric-chart"]')?.getAttribute('data-metric') ?? null);
  if (beforeMetric === null || afterMetric !== 'engagements' || beforeMetric === afterMetric) {
    console.error(`FAIL analytics: KPI tab did not swap the chart (${beforeMetric} → ${afterMetric})`); failed = true;
  } else console.log('ok kpi tab swaps chart metric');

  // S5 probes: analytics bands 2–3 — posts rows XOR empty, audience panel, spend band present
  await page.goto(WEB + '/analytics', { waitUntil: 'networkidle' });
  await page.click('[data-probe="range-all"]').catch(() => {});
  await page.waitForTimeout(500);
  const bands = await page.evaluate(() => ({
    postRows: document.querySelectorAll('[data-probe="post-row"]').length,
    postsEmpty: !!document.querySelector('[data-probe="posts-empty"]'),
    audience: !!document.querySelector('[data-probe="audience-panel"]'),
    spend: !!document.querySelector('[data-probe="spend-band"]'),
  }));
  if (!(bands.postRows > 0 || bands.postsEmpty)) { console.error('FAIL analytics: posts panel rendered neither rows nor empty state'); failed = true; }
  if (!bands.audience) { console.error('FAIL analytics: audience panel missing'); failed = true; }
  if (!bands.spend) { console.error('FAIL analytics: spend band missing'); failed = true; }
  else console.log(`ok analytics bands 2-3 (${bands.postRows} post rows)`);

  // S6 probe: post detail renders the stat strip (post #1 is measured)
  await page.goto(WEB + '/analytics/1', { waitUntil: 'networkidle' });
  const detail = await page.evaluate(() => ({
    stats: !!document.querySelector('[data-probe="post-stats"]'),
  }));
  if (!detail.stats) { console.error('FAIL post detail: stat strip missing on /analytics/1'); failed = true; }
  else console.log('ok post detail stat strip');

  // S8 probes: planner agenda stream — today group, slot-row popover opens+closes, rail present
  await page.goto(WEB + '/planner', { waitUntil: 'networkidle' });
  const todayKey = iso(new Date());
  const stream = await page.evaluate((d) => ({
    today: !!document.querySelector(`[data-day="${d}"]`),
    slots: document.querySelectorAll('[data-probe="slot-row"]').length,
    mini: !!document.querySelector('[data-probe="mini-month"]'),
    queue: !!document.querySelector('[data-probe="queue-rail"]'),
  }), todayKey);
  if (!stream.today) { console.error(`FAIL planner: no day group for today (${todayKey})`); failed = true; }
  if (stream.slots === 0) { console.error('FAIL planner: no slot rows rendered'); failed = true; }
  if (!stream.mini || !stream.queue) { console.error('FAIL planner: mini-month or queue rail missing'); failed = true; }
  else console.log('ok planner stream skeleton');

  await page.click('[data-probe="slot-row"]').catch(() => {});
  const dlgOpen = await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).then(() => true).catch(() => false);
  if (!dlgOpen) { console.error('FAIL planner: slot row did not open the assign popover'); failed = true; }
  else {
    await page.keyboard.press('Escape');
    const dlgGone = await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 3000 })
      .then(() => true).catch(() => false);
    if (!dlgGone) { console.error('FAIL planner: assign popover did not close on Escape'); failed = true; }
    else console.log('ok planner assign popover open/close');
  }

  // S10 probe: dark theme — the lightbox scrim is DARK in dark mode (bg-hero, not inverted ink).
  // --hero is a theme-INDEPENDENT constant (#0E100F → rgb(14, 16, 15)); with /80 alpha the rgb
  // triplet still leads, so the assertion reads the triplet rather than the alpha.
  await page.evaluate(() => localStorage.setItem('forge:theme', 'dark'));
  await page.goto(WEB + '/posts/4', { waitUntil: 'networkidle' });
  // The candidate grid lives behind the workspace's "image" tab — switching tabs is local state,
  // it mutates nothing. Read-only: the "open full size" button only opens the lightbox.
  await page.click('button:text-is("image")').catch(() => {});
  const thumb = await page.waitForSelector('button[title="open full size"]', { timeout: 5000 }).catch(() => null);
  if (thumb) {
    await thumb.click();
    await page.waitForSelector('[data-surface="dark"].fixed', { timeout: 3000 }).catch(() => {});
    // Tailwind v4 emits the /80 alpha as an oklab color-mix, so the computed value is not an
    // rgb() triplet. Assert the two things that actually matter: the scope resolves --ink to the
    // theme-independent LIGHT constant, and the scrim itself is DARK. The regression this catches
    // is bg-ink/80 in dark theme — --ink would be #E7ECEA there, giving a near-white scrim.
    const scrim = await page.evaluate(() => {
      const el = document.querySelector('[data-surface="dark"].fixed');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, ink: cs.getPropertyValue('--ink').trim() };
    });
    const lightness = (c) => {
      const ok = /oklab\(\s*([\d.]+)/.exec(c ?? '');
      if (ok) return Number(ok[1]);
      const rgb = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(c ?? '');
      return rgb ? (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / (3 * 255) : NaN;
    };
    if (!scrim) { console.error('FAIL dark lightbox: no dark-surface scrim element found'); failed = true; }
    else if (scrim.ink.toUpperCase() !== '#E7ECEA') {
      console.error(`FAIL dark lightbox: scoped --ink is ${scrim.ink}, expected the light constant #E7ECEA`); failed = true;
    } else if (!(lightness(scrim.bg) < 0.3)) {
      console.error(`FAIL dark lightbox: scrim background is ${scrim.bg} — not dark (inverted?)`); failed = true;
    } else console.log(`ok dark lightbox scrim (${scrim.bg})`);
    await page.keyboard.press('Escape');
  } else console.log('skip dark-lightbox probe: no asset candidate found on /posts/4');
  await page.evaluate(() => localStorage.removeItem('forge:theme'));
} finally {
  await put(before.scheduledDate ? { date: before.scheduledDate, time: before.scheduledTime?.slice(0, 5) ?? undefined } : { date: null });
  await browser.close();
}
if (errors.length) { console.error('console errors:'); for (const e of errors) console.error('  ' + e); failed = true; }
console.log(failed ? 'SMOKE FAIL' : 'SMOKE PASS');
process.exit(failed ? 1 : 0);
