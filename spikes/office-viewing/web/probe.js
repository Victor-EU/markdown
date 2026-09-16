// Count the workers the library makes, and whether making one fails.
const RealWorker = globalThis.Worker;
const workers = { made: 0, dataUrl: 0, urls: [], failed: [] };
globalThis.Worker = class extends RealWorker {
  constructor(url, opts) {
    try { super(url, opts); workers.made++; workers.urls.push(String(url).slice(0, 100)); if (String(url).startsWith('data:')) workers.dataUrl++; }
    catch (e) { workers.failed.push(String(e?.message ?? e).slice(0, 120)); throw e; }
  }
};

/**
 * Probes for the scope of the office-viewing work:
 *   - does the library load under the app's CSP (its parse worker is a data: URL)?
 *   - are text runs in points when asked at the page's point width?
 *   - what does progressive layout do on a long document?
 *   - does a Carlito registered as "Calibri" change the layout?
 * ?f=samples/thesis.docx&progressive=1&shim=1
 */
const q = new URLSearchParams(location.search);
const file = q.get('f') ?? 'samples/thesis.docx';
const kind = file.endsWith('.pptx') ? 'pptx' : 'docx';
const r = { file, errors: [], steps: [] };
const t = () => Math.round(performance.now());
addEventListener('error', (e) => r.errors.push('error: ' + e.message));
addEventListener('unhandledrejection', (e) => r.errors.push('rejection: ' + String(e.reason?.message ?? e.reason)));
addEventListener('securitypolicyviolation', (e) => r.errors.push(`csp: ${e.violatedDirective} blocked ${e.blockedURI.slice(0, 40)}`));
try {
  if (q.get('shim') === '1') {
    const face = (family, file, weight, style) => new FontFace(family, `local("${family}"), url(../node_modules/@fontsource/${file}) format("woff2")`, { weight, style });
    const faces = [
      face('Calibri', 'carlito/files/carlito-latin-400-normal.woff2', '400', 'normal'),
      face('Calibri', 'carlito/files/carlito-latin-700-normal.woff2', '700', 'normal'),
      face('Calibri', 'carlito/files/carlito-latin-400-italic.woff2', '400', 'italic'),
      face('Cambria', 'caladea/files/caladea-latin-400-normal.woff2', '400', 'normal'),
    ];
    for (const f of faces) document.fonts.add(await f.load());
    r.shim = { loaded: faces.length, calibriWidth: (() => { const c = document.createElement('canvas').getContext('2d'); c.font = '100px Calibri'; return Math.round(c.measureText('The quick brown fox').width); })() };
  } else {
    const c = document.createElement('canvas').getContext('2d'); c.font = '100px Calibri';
    r.noShimCalibriWidth = Math.round(c.measureText('The quick brown fox').width);
  }
  const mod = await import(`../node_modules/@silurus/ooxml/dist/${kind}.mjs`);
  const { math } = await import('../node_modules/@silurus/ooxml/dist/math.mjs');
  const t0 = t();
  const progressive = q.get('progressive') === '1';
  const doc = kind === 'docx'
    ? await mod.DocxDocument.load('../' + file, { math, progressiveLayout: progressive })
    : await mod.PptxPresentation.load('../' + file, { math });
  r.steps.push({ step: 'load resolved', ms: t() - t0, pages: kind === 'docx' ? doc.pageCount : doc.slideCount, layoutComplete: doc.layoutComplete, mode: doc.mode });
  // First page as soon as load resolves.
  const size = kind === 'docx' ? { w: doc.pageSize(0).widthPt, h: doc.pageSize(0).heightPt } : { w: doc.slideWidth, h: doc.slideHeight };
  const canvas = document.createElement('canvas'); document.getElementById('host').append(canvas);
  const t1 = t();
  if (kind === 'docx') await doc.renderPage(canvas, 0, { width: size.w, dpr: 1 }); else await doc.renderSlide(canvas, 0, { width: size.w, dpr: 1 });
  r.steps.push({ step: 'page 1 drawn', ms: t() - t0, drawMs: t() - t1, canvas: [canvas.width, canvas.height], pages: kind === 'docx' ? doc.pageCount : doc.slideCount });
  await doc.waitUntilLayoutComplete();
  r.steps.push({ step: 'layout complete', ms: t() - t0, pages: kind === 'docx' ? doc.pageCount : doc.slideCount });
  // Text runs at the page's own point width: are they in points?
  const runs = kind === 'docx' ? await doc.collectPageRuns(0, { width: size.w }) : await doc.collectSlideRuns(0, size.w);
  const right = Math.max(...runs.map((x) => (kind === 'docx' ? x.x + x.w : x.shapeX + x.inShapeX + x.w)));
  const bottom = Math.max(...runs.map((x) => (kind === 'docx' ? x.y + x.h : x.shapeY + x.inShapeY + x.h)));
  r.runs = { count: runs.length, pageWidthPt: size.w, pageHeightPt: size.h, rightmost: Math.round(right), lowest: Math.round(bottom), sample: runs.slice(0, 3).map((x) => ({ text: x.text.slice(0, 24), x: Math.round(x.x ?? x.inShapeX), y: Math.round(x.y ?? x.inShapeY), w: Math.round(x.w), h: Math.round(x.h) })) };
  // A cheap fingerprint of page 1, so the shim's effect on layout shows as a number.
  const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 128) dark++;
  r.page1 = { darkPixels: dark, pages: kind === 'docx' ? doc.pageCount : doc.slideCount, lines: runs.length };
  r.metrics = await doc.getResourceMetrics().catch((e) => String(e));
} catch (e) { r.errors.push('caught: ' + (e?.code ? e.code + ' ' : '') + (e?.message ?? e)); }
r.workers = workers; r.cspMeta = document.querySelector('meta[http-equiv]')?.content ?? null;
window.__probe = r;
document.title = 'done';
