// Run every (library, file) pair in WebKit, screenshot the pages that
// matter, and write out/results.json and out/report.md.
//
//   node run.mjs            every pair
//   node run.mjs thesis     only files whose name contains "thesis"
//
// Playwright comes from the repository root's node_modules; the browser
// suite already keeps its WebKit build installed.
import { chromium, webkit } from 'playwright';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORT, serve } from './serve.mjs';

const ROOT = import.meta.dirname;
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
const filter = process.argv[2] ?? '';
const engineName = process.env.ENGINE ?? 'webkit';
const engine = engineName === 'chromium' ? chromium : webkit;
const WIDTH = 720;
/** Which pages get their own screenshot, one-based. */
const PAGES = [1, 2, 3, 12];

const files = [
  ...readdirSync(join(ROOT, 'fixtures')).map((f) => 'fixtures/' + f),
  ...readdirSync(join(ROOT, 'samples')).map((f) => 'samples/' + f),
].filter((f) => /\.(docx|pptx)$/.test(f) && f.includes(filter));
const libsFor = (f) => (f.endsWith('.pptx') ? ['silurus', 'aiden'] : ['silurus', 'docxpreview']);

const server = await serve();
const browser = await engine.launch();
console.log(engineName, browser.version());
const results = [];
for (const file of files) {
  for (const lib of libsFor(file)) {
    const page = await browser.newPage({ viewport: { width: WIDTH + 64, height: 1000 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    const url = `http://127.0.0.1:${PORT}/web/index.html?lib=${lib}&f=${file}&w=${WIDTH}`;
    const started = Date.now();
    await page.goto(url);
    let timedOut = false;
    await page.waitForFunction(() => document.title === 'done', null, { timeout: 180_000 }).catch(() => { timedOut = true; });
    const wall = Date.now() - started;
    const result = (await page.evaluate(() => window.__result).catch(() => null)) ?? { lib, file, errors: ['no result'] };
    result.wallMs = wall;
    result.timedOut = timedOut;
    result.errors = [...(result.errors ?? []), ...errors];
    result.engine = `${engineName} ${browser.version()}`;
    const stem = `${lib}-${file.replace(/.*\//, '').replace(/\.(docx|pptx)$/, '-$1')}`;
    // Screenshots: the first screen, then the chosen pages by element.
    await page.screenshot({ path: join(OUT, `${stem}-top.png`) });
    const selector = lib === 'silurus' ? '#host > canvas' : lib === 'docxpreview' ? 'section.docx' : '#host [data-slide-index]';
    const els = await page.$$(selector);
    result.elements = els.length;
    for (const n of PAGES) {
      const el = els[n - 1];
      if (!el) continue;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.screenshot({ path: join(OUT, `${stem}-p${n}.png`) }).catch((e) => errors.push(`shot p${n}: ${e.message}`));
    }
    results.push(result);
    console.log(`${stem}: ${result.pages ?? '?'} pages, load ${result.ms?.load ?? '?'} ms, render ${result.ms?.render ?? '?'} ms, wall ${wall} ms${result.errors.length ? `, ERRORS ${result.errors.length}` : ''}`);
    await page.close();
  }
}
await browser.close();
server.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));

const rows = results.map((r) => `| ${r.file} | ${r.lib} | ${r.pages ?? '?'} | ${r.ms?.load ?? '?'} | ${r.ms?.render ?? '?'} | ${r.wallMs} | ${(r.fonts?.asked ?? []).join(', ')} | ${r.errors.length ? r.errors[0].slice(0, 80) : ''} |`);
writeFileSync(join(OUT, 'report.md'), `# Spike run · ${new Date().toISOString().slice(0, 16)} · ${results[0]?.engine ?? ''}\n\n| File | Library | Pages | Load ms | Render ms | Wall ms | Fonts asked | First error |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
console.log('wrote out/results.json and out/report.md');
