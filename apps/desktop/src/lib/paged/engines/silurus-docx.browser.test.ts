import { createFakeIpc } from '@markdown/ipc/fake';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Workspace } from '../../workspace.svelte.ts';
import { type PagedDocument, PagedError } from '../engine.ts';
import longUrl from '../fixtures/long.docx?url';
import memoUrl from '../fixtures/memo.docx?url';
import notOoxmlUrl from '../fixtures/not-ooxml.docx?url';
import { failureOf, SilurusDocxEngine } from './silurus-docx.ts';

/**
 * The Word adapter against real files, in both engines (ADR 0042), in
 * the shape of `pdfjs.browser.test.ts`. The fixtures are what
 * `tools/office-fixtures` writes: a one-page memo and a document long
 * enough that the engine lays it out progressively.
 */

const engine = new SilurusDocxEngine();
const opened: PagedDocument[] = [];

async function open(url: string, onPages?: (pages: number, complete: boolean) => void) {
  const doc = await engine.open(url, onPages ? { onPages } : undefined);
  opened.push(doc);
  return doc;
}

afterEach(() => {
  for (const doc of opened.splice(0)) doc.destroy();
});

/** Wait for something to be true rather than for a fixed moment. */
async function until(check: () => boolean, ms = 20_000): Promise<void> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('the Word engine', () => {
  // The first open in a fresh page compiles the parser's WebAssembly
  // and makes its worker; the runner's default two seconds is not for
  // that, and none of the tests here are quick on a starved machine.
  beforeAll(async () => {
    await open(memoUrl);
  }, 60_000);

  it('counts the pages and measures them in points', { timeout: 30_000 }, async () => {
    const doc = await open(memoUrl);
    expect(doc.pages).toBe(1);
    const size = await doc.size(1);
    // A4, which is what `docx` writes when nothing says otherwise.
    expect(Math.round(size.width)).toBe(595);
    expect(Math.round(size.height)).toBe(842);
  });

  it('draws a page into the canvas it is given, at the scale it is asked for', {
    timeout: 30_000,
  }, async () => {
    const doc = await open(memoUrl);
    const canvas = document.createElement('canvas');
    // The view sizes the box and expects it left alone; the library
    // would otherwise size it to the bitmap, and a Retina page would
    // come out twice as wide as its column.
    canvas.style.width = '100px';
    canvas.style.height = '141px';
    await doc.render({ page: 1, scale: 0.5, canvas });
    // Half a point per pixel: a 595-point page is 298 pixels wide.
    expect(canvas.width).toBeGreaterThanOrEqual(296);
    expect(canvas.width).toBeLessThanOrEqual(300);
    expect(canvas.style.width).toBe('100px');
    expect(canvas.style.height).toBe('141px');
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < (pixels?.length ?? 0); i += 4) if ((pixels?.[i] ?? 255) < 128) dark++;
    // Ink on the page: the title alone is hundreds of dark pixels.
    expect(dark).toBeGreaterThan(200);
  });

  it('hands back the text as runs with rectangles inside the page', {
    timeout: 30_000,
  }, async () => {
    const doc = await open(memoUrl);
    const runs = await doc.text(1);
    const size = await doc.size(1);
    expect(runs.length).toBeGreaterThan(10);
    // Runs carry their own spacing, as pdf.js's do.
    const joined = runs.map((run) => run.text).join('');
    expect(joined).toContain('Northgate Advisory');
    expect(joined).toContain('€10.58m');
    for (const run of runs) {
      const [x, y, w, h] = run.rect;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(size.width + 1);
      expect(y + h).toBeLessThanOrEqual(size.height + 1);
    }
  });

  it('lays a long document out progressively, and says when it is done', {
    timeout: 60_000,
  }, async () => {
    const reports: [number, boolean][] = [];
    const doc = await open(longUrl, (pages, complete) => reports.push([pages, complete]));
    await until(() => reports.some(([, complete]) => complete));
    const final = reports.at(-1);
    expect(final?.[1]).toBe(true);
    expect(doc.pages).toBe(final?.[0]);
    // Many pages, whatever the exact count comes to on this platform's
    // fonts; and the counts only ever went up.
    expect(doc.pages).toBeGreaterThan(15);
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i]?.[0]).toBeGreaterThanOrEqual(reports[i - 1]?.[0] ?? 0);
    }
  });

  it('refuses a file that is not a Word document as corrupt', { timeout: 30_000 }, async () => {
    await expect(engine.open(notOoxmlUrl)).rejects.toSatisfy(
      (error: unknown) => error instanceof PagedError && error.reason === 'corrupt',
    );
  });

  it('names the port’s reasons from the library’s codes', () => {
    expect(failureOf({ code: 'encrypted' })).toBe('password');
    expect(failureOf({ code: 'invalid-password' })).toBe('password');
    expect(failureOf({ code: 'legacy-binary-format' })).toBe('corrupt');
    expect(failureOf({ code: 'not-ooxml' })).toBe('corrupt');
    expect(failureOf(new Error('worker timed out'))).toBe('unavailable');
    expect(failureOf(new Error('page size must be positive'))).toBe('corrupt');
  });
});

describe('a Word document through the shell', () => {
  let workspace: Workspace;
  let host: HTMLDivElement;

  afterEach(() => {
    workspace?.destroy();
    host?.remove();
  });

  it('opens, draws, counts and searches, all through the port', { timeout: 60_000 }, async () => {
    host = document.createElement('div');
    host.style.height = '600px';
    host.style.overflow = 'auto';
    document.body.append(host);
    const ipc = createFakeIpc({ '/a/memo.docx': 'PK' });
    workspace = new Workspace({
      commands: ipc.commands,
      pageEngines: { docx: engine },
      assetUrl: () => memoUrl,
    });
    await workspace.openPaths(['/a/memo.docx']);
    expect(workspace.activeTab?.kind).toBe('paged');
    expect(workspace.status).toBe('memo.docx · 1 page');
    await workspace.mountPaged(host);
    await until(() => host.querySelectorAll('.paged-page').length > 0);
    workspace.openFind(false);
    workspace.updateFind({ query: 'Helix' });
    await until(() => workspace.matches.total === 1);
    expect(workspace.matches.total).toBe(1);
    await until(() => host.querySelectorAll('.paged-text mark').length === 1);
    expect(host.querySelector('.paged-text mark')?.textContent).toBe('Helix');
  });
});
