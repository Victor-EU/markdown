// The probes behind the scope of docs/office-viewing.md; see web/probe.html.
import pw from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORT, serve } from './serve.mjs';
const { webkit } = pw;
const APP_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";
const CSP_ONLY = process.argv[2] === 'csp';
const cases = [
  { name: 'app-csp docx', f: 'samples/thesis.docx', csp: APP_CSP },
  { name: 'app-csp docx, img-src without blob:', f: 'samples/thesis.docx', csp: APP_CSP.replace(' blob:', '') },
  { name: 'app-csp docx + worker-src data:', f: 'samples/thesis.docx', csp: APP_CSP + "; worker-src 'self' data: blob:" },
  { name: 'app-csp pptx', f: 'samples/northgate-kimi.pptx', csp: APP_CSP },
  { name: 'no csp docx (worker count)', f: 'samples/thesis.docx', csp: null },
  { name: 'no csp, progressive', f: 'samples/thesis.docx', csp: null, progressive: 1 },
  { name: 'no csp, not progressive', f: 'samples/thesis.docx', csp: null, progressive: 0 },
  { name: 'no csp, memo, shim off', f: 'fixtures/agent-memo.docx', csp: null },
  { name: 'no csp, memo, shim on', f: 'fixtures/agent-memo.docx', csp: null, shim: 1 },
  { name: 'no csp, thesis, shim on', f: 'samples/thesis.docx', csp: null, shim: 1 },
];
const html = readFileSync(join(import.meta.dirname, 'web', 'probe.html'), 'utf8');
const server = await serve();
const browser = await webkit.launch();
const out = [];
for (const c of (CSP_ONLY ? cases.slice(0, 5) : cases)) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
  // Serve the probe page with the case's CSP as a <meta> tag, through a route.
  await page.route((u) => u.pathname.endsWith('/web/probe.html'), (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: c.csp ? html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${c.csp}">`) : html }));
  const url = `http://127.0.0.1:${PORT}/web/probe.html?f=${c.f}&progressive=${c.progressive ?? 0}&shim=${c.shim ?? 0}`;
  await page.goto(url);
  await page.waitForFunction(() => document.title === 'done', null, { timeout: 120_000 }).catch(() => errors.push('timeout'));
  const r = (await page.evaluate(() => window.__probe).catch(() => null)) ?? {};
  r.name = c.name; r.errors = [...(r.errors ?? []), ...errors];
  out.push(r);
  console.log(`\n## ${c.name}`); console.log(JSON.stringify({ cspMeta: r.cspMeta, workers: r.workers, steps: r.steps, runs: r.runs && { ...r.runs, sample: undefined }, page1: r.page1, shim: r.shim, noShimCalibriWidth: r.noShimCalibriWidth, errors: r.errors.slice(0, 4) }, null, 1));
  await page.close();
}
await browser.close(); server.close();
writeFileSync(join(import.meta.dirname, 'out', 'probe.json'), JSON.stringify(out, null, 2));
