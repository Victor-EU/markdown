import { createFakeIpc } from '@markdown/ipc/fake';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Workspace } from '../../workspace.svelte.ts';
import { type PagedDocument, PagedError } from '../engine.ts';
import deckUrl from '../fixtures/deck.pptx?url';
import notOoxmlUrl from '../fixtures/not-ooxml.docx?url';
import { SilurusPptxEngine } from './silurus-pptx.ts';

/**
 * The PowerPoint adapter against a real deck, in both engines (ADR
 * 0042). The deck is what `tools/office-fixtures` writes with pptxgenjs:
 * five 16:9 slides — a title, bullets, a table, a shape, and one with
 * speaker notes.
 */

const engine = new SilurusPptxEngine();
const opened: PagedDocument[] = [];

async function open(url: string) {
  const doc = await engine.open(url);
  opened.push(doc);
  return doc;
}

afterEach(() => {
  for (const doc of opened.splice(0)) doc.destroy();
});

async function until(check: () => boolean, ms = 20_000): Promise<void> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('the PowerPoint engine', () => {
  beforeAll(async () => {
    await open(deckUrl);
  }, 60_000);

  it('counts the slides and measures them in points, not EMU', { timeout: 30_000 }, async () => {
    const doc = await open(deckUrl);
    expect(doc.pages).toBe(5);
    const size = await doc.size(1);
    // pptxgenjs's 16:9 layout is 10 by 5.625 inches.
    expect(Math.round(size.width)).toBe(720);
    expect(Math.round(size.height)).toBe(405);
  });

  it('draws a slide into the canvas it is given, leaving the box alone', {
    timeout: 30_000,
  }, async () => {
    const doc = await open(deckUrl);
    const canvas = document.createElement('canvas');
    canvas.style.width = '360px';
    canvas.style.height = '203px';
    await doc.render({ page: 1, scale: 0.5, canvas });
    expect(canvas.width).toBeGreaterThanOrEqual(358);
    expect(canvas.width).toBeLessThanOrEqual(362);
    expect(canvas.style.width).toBe('360px');
    // The title slide has a dark background: most of it is ink.
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < (pixels?.length ?? 0); i += 4) if ((pixels?.[i] ?? 255) < 128) dark++;
    expect(dark).toBeGreaterThan((canvas.width * canvas.height) / 2);
  });

  it('hands back the text as runs with rectangles inside the slide', {
    timeout: 30_000,
  }, async () => {
    const doc = await open(deckUrl);
    const runs = await doc.text(2);
    const size = await doc.size(2);
    const joined = runs.map((run) => run.text).join('');
    expect(joined).toContain('Three things to take away');
    expect(joined).toContain('stale');
    for (const run of runs) {
      const [x, y, w, h] = run.rect;
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(x + w).toBeLessThanOrEqual(size.width + 1);
      expect(y + h).toBeLessThanOrEqual(size.height + 1);
    }
  });

  it('refuses a file that is not a deck as corrupt', { timeout: 30_000 }, async () => {
    await expect(engine.open(notOoxmlUrl)).rejects.toSatisfy(
      (error: unknown) => error instanceof PagedError && error.reason === 'corrupt',
    );
  });
});

describe('a deck through the shell', () => {
  let workspace: Workspace;
  let host: HTMLDivElement;

  afterEach(() => {
    workspace?.destroy();
    host?.remove();
  });

  it('opens, counts slides, draws and searches, all through the port', {
    timeout: 60_000,
  }, async () => {
    host = document.createElement('div');
    host.style.height = '600px';
    host.style.overflow = 'auto';
    document.body.append(host);
    const ipc = createFakeIpc({ '/a/deck.pptx': 'PK' });
    workspace = new Workspace({
      commands: ipc.commands,
      pageEngines: { pptx: engine },
      assetUrl: () => deckUrl,
    });
    await workspace.openPaths(['/a/deck.pptx']);
    expect(workspace.status).toBe('deck.pptx · 5 slides');
    await workspace.mountPaged(host);
    await until(() => host.querySelectorAll('.paged-page').length > 0);
    workspace.openFind(false);
    workspace.updateFind({ query: 'stale' });
    await until(() => workspace.matches.total === 1);
    expect(workspace.matches.total).toBe(1);
    expect(workspace.findStep(true)).toBe(true);
    expect(workspace.pagedPage).toBe(2);
  });
});
