import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDarkEffect } from './state.ts';
import { parsedEditor } from './test-helpers.ts';
import type { Editor } from './view.ts';

describe('the selection drawn on the text', () => {
  let host: HTMLDivElement;
  let editor: Editor;

  /** The outlines are measured, so they are drawn in the next frame. */
  const drawn = () => new Promise((resolve) => requestAnimationFrame(resolve));

  const mount = async (doc: string, width = 600) => {
    host.style.cssText = `height: 400px; width: ${width}px;`;
    editor = parsedEditor(host, doc);
    await drawn();
  };

  const select = async (anchor: number, head: number) => {
    editor.view.dispatch({ selection: { anchor, head } });
    await drawn();
  };

  /** The paths' own bounds: each `svg` box is rounded out to whole pixels. */
  const outlines = () =>
    [...host.querySelectorAll('.mdr-selectionLayer path')].map((path) =>
      path.getBoundingClientRect(),
    );

  /** Where the view draws a position's character, from one side or the other. */
  const at = (pos: number, side: 1 | -1) => {
    const coords = editor.view.coordsAtPos(pos, side);
    if (!coords) throw new Error(`nothing drawn at ${pos}`);
    return coords;
  };

  const nub = () => editor.view.defaultCharacterWidth / 2;

  /**
   * Within a pixel: CodeMirror's coordinates and the text's own boxes
   * round differently in WebKit.
   */
  const near = (actual: number | undefined, expected: number) => {
    expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(1);
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('draws nothing for a cursor', async () => {
    await mount('One line.\n');
    await select(3, 3);
    expect(outlines()).toHaveLength(0);
  });

  /**
   * The case that was reported: a short line in a selection that goes on
   * was filled out to the column's right edge.
   */
  it('ends a short line at its text and its break, not at the column edge', async () => {
    const doc = 'Short.\nA second line that runs on for a good while longer.\n';
    await mount(doc);
    const second = doc.indexOf('A second');
    await select(0, second + 1);
    const [shape] = outlines();
    expect(outlines()).toHaveLength(1);
    near(shape?.right, at(6, -1).right + nub());
    const column = editor.view.contentDOM.getBoundingClientRect();
    expect(shape?.right ?? Number.POSITIVE_INFINITY).toBeLessThan(column.right - 200);
  });

  it('starts and ends on the letters selected inside one line', async () => {
    const doc = 'Some words on the first line.\n';
    await mount(doc);
    const from = doc.indexOf('first');
    const to = from + 'first'.length;
    await select(from, to);
    const [shape] = outlines();
    expect(outlines()).toHaveLength(1);
    near(shape?.left, at(from, 1).left);
    near(shape?.right, at(to, -1).right);
  });

  it('steps out to the left only on the line it starts at the left of', async () => {
    const doc = 'Some words on the first line.\nAnd more words, on a second line that is longer.\n';
    await mount(doc);
    const from = doc.indexOf('first');
    await select(from, doc.length - 1);
    const [shape] = outlines();
    expect(outlines()).toHaveLength(1);
    near(shape?.left, at(doc.indexOf('And'), 1).left);
    near(shape?.right, at(doc.length - 1, -1).right);
    // Its top is the first line's, around the letters selected there.
    expect(shape?.top).toBeLessThan(at(from, 1).top);
  });

  it('draws a selected line break alone as a nub', async () => {
    await mount('One.\nTwo.\n');
    await select(4, 5);
    const [shape] = outlines();
    expect(outlines()).toHaveLength(1);
    near(shape?.left, at(4, -1).right);
    near(shape?.width, nub());
  });

  it('draws a wrapped paragraph as one outline as tall as its lines', async () => {
    const paragraph =
      'A paragraph long enough to wrap onto several lines in a narrow editor, so that a ' +
      'selection over all of it covers more than one visual row of the same document line.';
    await mount(`${paragraph}\n`, 240);
    await select(0, paragraph.length);
    const shapes = outlines();
    expect(shapes).toHaveLength(1);
    const rows = (at(paragraph.length, -1).bottom - at(0, 1).top) / editor.view.defaultLineHeight;
    expect(rows).toBeGreaterThan(2);
    expect(shapes[0]?.height).toBeGreaterThanOrEqual(
      at(paragraph.length, -1).bottom - at(0, 1).top,
    );
  });

  it('joins two paragraphs through the blank line between them', async () => {
    const doc = 'First paragraph.\n\nSecond paragraph.\n';
    await mount(doc);
    await select(0, doc.indexOf('Second') + 'Second paragraph.'.length);
    expect(outlines()).toHaveLength(1);
  });

  it('draws as two shapes the rows that do not overlap', async () => {
    const doc = 'A line that ends far to the right.\nNext.\n';
    await mount(doc);
    await select(doc.indexOf('right'), doc.indexOf('Next') + 2);
    expect(outlines()).toHaveLength(2);
  });

  it('covers selected code in a fence, whose ground it is drawn over', async () => {
    const doc = 'Before.\n\n```\nlet code = 1;\n```\n\nAfter.\n';
    await mount(doc);
    const code = doc.indexOf('let');
    await select(code, code + 'let code'.length);
    const line = host.querySelector('.mdr-fence:not(.mdr-fence-edge)')?.getBoundingClientRect();
    const [shape] = outlines();
    expect(line).toBeDefined();
    expect(shape?.top ?? 0).toBeGreaterThanOrEqual((line?.top ?? 0) - 1);
    expect(shape?.bottom ?? 0).toBeLessThanOrEqual((line?.bottom ?? 0) + 1);
    near(shape?.width, at(code + 8, -1).right - at(code, 1).left);
  });

  it('leaves bullets, checkboxes and numbers outside the highlight', async () => {
    for (const doc of ['- one\n- two\n', '- [ ] one\n- [x] two\n', '1. one\n2. two\n']) {
      editor?.destroy();
      await mount(doc);
      await select(0, doc.length - 1);
      const text = doc.indexOf('one');
      const marker = host
        .querySelector('.mdr-bullet, .mdr-checkbox, .mdr-ol-mark')
        ?.getBoundingClientRect();
      const [shape] = outlines();
      expect(marker).toBeDefined();
      expect(outlines()).toHaveLength(1);
      near(shape?.left, at(text, 1).left);
      expect(shape?.left ?? 0).toBeGreaterThanOrEqual((marker?.right ?? 0) - 1);
    }
  });

  it('draws a list marker as selected when nothing else on its line is', async () => {
    const doc = '1. one\n';
    await mount(doc);
    await select(0, 2);
    expect(outlines()).toHaveLength(1);
  });

  it('sits above the text and blends into it, screened on a dark paper', async () => {
    await mount('Some text.\n');
    const layer = host.querySelector('.mdr-selectionLayer') as HTMLElement;
    expect(layer.classList.contains('cm-layer-above')).toBe(true);
    expect(getComputedStyle(layer).mixBlendMode).toBe('multiply');
    editor.view.dispatch({ effects: setDarkEffect(true) });
    expect(getComputedStyle(layer).mixBlendMode).toBe('screen');
  });

  it('hides the layer CodeMirror draws its own selection in', async () => {
    await mount('Some text.\n');
    const own = host.querySelector('.cm-selectionLayer') as HTMLElement;
    expect(getComputedStyle(own).display).toBe('none');
  });

  /** WebKit blends nothing outside the blending element's own box. */
  it('is as tall as the document, and grows with it', async () => {
    await mount('One.\n');
    const layer = host.querySelector('.mdr-selectionLayer') as HTMLElement;
    expect(layer.style.height).toBe(`${Math.ceil(editor.view.contentHeight)}px`);
    editor.view.dispatch({ changes: { from: 0, insert: 'More.\n'.repeat(200) } });
    await drawn();
    expect(layer.style.height).toBe(`${Math.ceil(editor.view.contentHeight)}px`);
    expect(layer.offsetHeight).toBeGreaterThan(400);
  });

  it('draws the same way in Source mode', async () => {
    const doc = 'Short.\nA second line that runs on for a good while longer.\n';
    await mount(doc);
    editor.setMode('source');
    await select(0, doc.indexOf('A second') + 1);
    expect(outlines()).toHaveLength(1);
    near(outlines()[0]?.right, at(6, -1).right + nub());
  });
});
