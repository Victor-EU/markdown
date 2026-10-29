import type { Extension, SelectionRange } from '@codemirror/state';
import { EditorView, type LayerMarker, layer } from '@codemirror/view';

/**
 * The selection, drawn on the text (ADR 0043).
 *
 * CodeMirror's own layer fills a selection over several lines out to the
 * column's edges and paints it under the text, where a code block's
 * ground covers it. This one draws each visual row only as wide as the
 * characters selected on it, joins the rows that touch into one outline,
 * and sits above the text. A selected paragraph is drawn as the shape of
 * the paragraph, and selected code looks selected.
 *
 * `drawSelection()` is still loaded, for the caret. Its selection layer
 * is hidden by the theme below rather than taken out, because CodeMirror
 * does not export the two separately.
 */

interface Row {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A shape as the layer draws it: its own box, and a path inside that box. */
interface Shape {
  x: number;
  y: number;
  width: number;
  height: number;
  d: string;
}

const SVG = 'http://www.w3.org/2000/svg';
/** The corner radius, on inner corners as well as outer ones. */
const RADIUS = 4;
/** Edges closer than this are drawn as one edge, so a ragged margin of a pixel does not step. */
const SNAP = 2;
/** A selected line break, in characters: enough to see, too little to read as a space. */
const NUB = 0.5;

class Outline implements LayerMarker {
  constructor(readonly shape: Shape) {}

  eq(other: LayerMarker): boolean {
    if (!(other instanceof Outline)) return false;
    const a = this.shape;
    const b = other.shape;
    return a.x === b.x && a.y === b.y && a.d === b.d;
  }

  draw(): HTMLElement {
    const svg = document.createElementNS(SVG, 'svg');
    svg.append(document.createElementNS(SVG, 'path'));
    this.update(svg as unknown as HTMLElement);
    return svg as unknown as HTMLElement;
  }

  /**
   * Each outline is an element the size of what it draws. WebKit blends
   * an element with what is under it only inside the element's own box,
   * so a path that merely overflowed a smaller one was painted flat, over
   * the text it was meant to tint.
   */
  update(dom: HTMLElement): boolean {
    const { x, y, width, height, d } = this.shape;
    dom.style.left = `${x}px`;
    dom.style.top = `${y}px`;
    dom.style.width = `${width}px`;
    dom.style.height = `${height}px`;
    (dom.firstChild as SVGPathElement).setAttribute('d', d);
    return true;
  }
}

function outlines(view: EditorView): readonly LayerMarker[] {
  const scroller = view.scrollDOM.getBoundingClientRect();
  const base = {
    left: scroller.left - view.scrollDOM.scrollLeft,
    top: scroller.top - view.scrollDOM.scrollTop,
  };
  const out: LayerMarker[] = [];
  for (const range of view.state.selection.ranges) {
    if (range.empty) continue;
    for (const rows of joined(textRows(view, range))) out.push(new Outline(outline(rows, base)));
  }
  return out;
}

/** The rows of text a range covers, one per visual line, in page order. */
function textRows(view: EditorView, range: SelectionRange): Row[] {
  const rows: Row[] = [];
  // Outside what is rendered there is nothing to measure, and nothing
  // that could be seen.
  const from = Math.max(range.from, view.viewport.from);
  const to = Math.min(range.to, view.viewport.to);
  if (from > to) return rows;
  const nub = view.defaultCharacterWidth * NUB;
  const { doc } = view.state;
  for (let pos = from; ; ) {
    const line = doc.lineAt(pos);
    const element = lineElement(view, line.from);
    // A line a block widget stands for has no text of its own to mark.
    // The reveal rule gives a block's source back as soon as a selection
    // touches it, so this is a widget that is not the document, such as
    // a review panel.
    if (element) {
      const a = Math.max(from, line.from);
      const b = Math.min(to, line.to);
      rows.push(...lineRows(view, element, a, b, range.to > line.to, nub));
    }
    if (line.to >= to) break;
    pos = line.to + 1;
  }
  return rows;
}

/** The `.cm-line` a position is drawn in, or null when something else draws it. */
function lineElement(view: EditorView, pos: number): HTMLElement | null {
  const { node } = view.domAtPos(pos);
  const start = node instanceof HTMLElement ? node : node.parentElement;
  const line = start?.closest('.cm-line');
  return line instanceof HTMLElement && line.parentElement === view.contentDOM ? line : null;
}

/**
 * The rows of one line between `a` and `b`, and, when the selection goes
 * on past the line's end, the nub that says its break is selected too.
 */
function lineRows(
  view: EditorView,
  element: HTMLElement,
  a: number,
  b: number,
  throughBreak: boolean,
  nub: number,
): Row[] {
  const text: DOMRect[] = [];
  const markers: DOMRect[] = [];
  if (a < b) {
    const start = view.domAtPos(a, 1);
    const end = view.domAtPos(b, -1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    collect(element, range, { text, markers }, false);
  }
  // A list item's row starts at its words, as in a word processor; its
  // marker is drawn as selected only when nothing else on the line is.
  const rows = byRow(text.length > 0 ? text : markers);
  const last = rows[rows.length - 1];
  if (last) {
    if (throughBreak) last.right += nub;
  } else {
    // Nothing on the line but its break: a blank line, or a selection
    // that starts at the end of one.
    if (!throughBreak) return [];
    const at = view.coordsAtPos(a, 1) ?? view.coordsAtPos(a, -1);
    if (!at) return [];
    rows.push({ left: at.left, right: at.left + nub, top: at.top, bottom: at.bottom });
  }
  // From the letters' height to the line's: half the leading above and
  // half below, so that the rows of a paragraph meet.
  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
  if (Number.isFinite(lineHeight)) {
    for (const row of rows) {
      const lead = Math.max(0, lineHeight - (row.bottom - row.top)) / 2;
      row.top -= lead;
      row.bottom += lead;
    }
  }
  return rows;
}

/** What live preview draws a list item's marker as: a bullet, a box, a number. */
const MARKER = '.mdr-bullet, .mdr-checkbox, .mdr-ol-mark';

/**
 * The boxes of the selected text and inline widgets under `node`, with
 * a list item's marker kept apart from its words.
 */
function collect(
  node: Node,
  range: Range,
  out: { text: DOMRect[]; markers: DOMRect[] },
  inMarker: boolean,
): void {
  if (!range.intersectsNode(node)) return;
  const into = inMarker ? out.markers : out.text;
  if (node instanceof Text) {
    let start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    // The space after a number is the marker's, as the bullet's is.
    if (start === 0 && !inMarker && followsMarker(node)) {
      while (start < end && (node.data[start] === ' ' || node.data[start] === '\t')) start++;
    }
    if (end <= start) return;
    const part = document.createRange();
    part.setStart(node, start);
    part.setEnd(node, end);
    for (const box of part.getClientRects()) if (box.width > 0.5) into.push(box);
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const widget = node.contentEditable === 'false';
  // A task's box is an input inside the widget's own span.
  const marker =
    inMarker || node.matches(MARKER) || (widget && node.querySelector(MARKER) !== null);
  if (widget) {
    // An inline widget, a note or a box, is selected whole or not at all.
    const parent = node.parentNode;
    if (!parent) return;
    const index = Array.prototype.indexOf.call(parent.childNodes, node);
    if (range.comparePoint(parent, index) >= 0 && range.comparePoint(parent, index + 1) <= 0) {
      const box = node.getBoundingClientRect();
      if (box.width > 0.5 && box.height > 0.5) (marker ? out.markers : out.text).push(box);
    }
    return;
  }
  for (const child of node.childNodes) collect(child, range, out, marker);
}

/** Whether the node comes straight after a list marker, past CodeMirror's spacer images. */
function followsMarker(node: Node): boolean {
  let prev = node.previousSibling;
  while (prev instanceof HTMLImageElement && prev.classList.contains('cm-widgetBuffer')) {
    prev = prev.previousSibling;
  }
  return (
    prev instanceof HTMLElement && (prev.matches(MARKER) || prev.querySelector(MARKER) !== null)
  );
}

/** Boxes on one visual line become one row: wrapped text is several. */
function byRow(boxes: readonly DOMRect[]): Row[] {
  const rows: Row[] = [];
  for (const box of [...boxes].sort((p, q) => p.top - q.top || p.left - q.left)) {
    const middle = (box.top + box.bottom) / 2;
    const row = rows.find((r) => middle > r.top && middle < r.bottom);
    if (row) {
      row.left = Math.min(row.left, box.left);
      row.right = Math.max(row.right, box.right);
      row.top = Math.min(row.top, box.top);
      row.bottom = Math.max(row.bottom, box.bottom);
    } else {
      rows.push({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
    }
  }
  return rows.sort((p, q) => p.top - q.top);
}

/**
 * Runs of rows that meet and overlap, each to be drawn as one outline.
 *
 * Rows of the same paragraph meet because each is a line's height. A
 * blank line's nub sits at the text's left edge, so it overlaps the
 * paragraphs on either side and joins them; a selection that starts
 * near the end of one line and stops near the start of the next has
 * rows that do not overlap, and is drawn as two shapes.
 */
function joined(rows: readonly Row[]): Row[][] {
  const runs: Row[][] = [];
  let run: Row[] = [];
  for (const row of rows) {
    const prev = run[run.length - 1];
    if (prev && Math.abs(prev.bottom - row.top) <= SNAP * 2) {
      const meet = (prev.bottom + row.top) / 2;
      prev.bottom = meet;
      row.top = meet;
      if (Math.abs(prev.left - row.left) <= SNAP) {
        row.left = Math.min(prev.left, row.left);
        prev.left = row.left;
      }
      if (Math.abs(prev.right - row.right) <= SNAP) {
        row.right = Math.max(prev.right, row.right);
        prev.right = row.right;
      }
      if (Math.min(prev.right, row.right) - Math.max(prev.left, row.left) > 1) {
        run.push(row);
        continue;
      }
    }
    if (run.length > 0) runs.push(run);
    run = [row];
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** The outline of rows stacked edge to edge, in the layer's coordinates. */
function outline(rows: readonly Row[], base: { left: number; top: number }): Shape {
  const first = rows[0] as Row;
  const last = rows[rows.length - 1] as Row;
  // Down the right side, then back up the left.
  const points: [number, number][] = [[first.left, first.top]];
  rows.forEach((row, i) => {
    points.push([row.right, row.top], [row.right, row.bottom]);
    const next = rows[i + 1];
    if (next) points.push([next.right, row.bottom]);
  });
  points.push([last.left, last.bottom]);
  for (let i = rows.length - 1; i > 0; i--) {
    const row = rows[i] as Row;
    const above = rows[i - 1] as Row;
    points.push([row.left, row.top], [above.left, row.top]);
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));
  const local = points.map(([px, py]): [number, number] => [px - x, py - y]);
  return {
    x: x - base.left,
    y: y - base.top,
    width: Math.ceil(Math.max(...xs)) - x,
    height: Math.ceil(Math.max(...ys)) - y,
    d: rounded(corners(local)),
  };
}

/** The points where the outline turns: no repeats, none in the middle of an edge. */
function corners(points: readonly [number, number][]): [number, number][] {
  const distinct = points.filter((p, i) => {
    const prev = points[(i + points.length - 1) % points.length] as [number, number];
    return i === 0 || p[0] !== prev[0] || p[1] !== prev[1];
  });
  return distinct.filter((p, i) => {
    const prev = distinct[(i + distinct.length - 1) % distinct.length] as [number, number];
    const next = distinct[(i + 1) % distinct.length] as [number, number];
    const straight =
      (prev[0] === p[0] && p[0] === next[0]) || (prev[1] === p[1] && p[1] === next[1]);
    return !straight;
  });
}

/** A closed path through the corners, each one rounded, no more than half its shorter edge. */
function rounded(points: readonly [number, number][]): string {
  const n = points.length;
  const f = (v: number) => Number(v.toFixed(1));
  let d = '';
  for (let i = 0; i < n; i++) {
    const [px, py] = points[(i + n - 1) % n] as [number, number];
    const [vx, vy] = points[i] as [number, number];
    const [qx, qy] = points[(i + 1) % n] as [number, number];
    const before = Math.hypot(vx - px, vy - py);
    const after = Math.hypot(qx - vx, qy - vy);
    const r = Math.min(RADIUS, before / 2, after / 2);
    const sx = vx + ((px - vx) / before) * r;
    const sy = vy + ((py - vy) / before) * r;
    const ex = vx + ((qx - vx) / after) * r;
    const ey = vy + ((qy - vy) / after) * r;
    d += `${i === 0 ? 'M' : 'L'}${f(sx)} ${f(sy)}Q${f(vx)} ${f(vy)} ${f(ex)} ${f(ey)}`;
  }
  return `${d}Z`;
}

/**
 * The layer is as tall as the document, for the same reason each outline
 * has a box: WebKit blends nothing outside the blending element's own
 * box, and CodeMirror's layers have no size.
 */
function fit(dom: HTMLElement, view: EditorView): void {
  const height = `${Math.ceil(view.contentHeight)}px`;
  if (dom.style.height !== height) dom.style.height = height;
}

const selectionLayer = layer({
  above: true,
  class: 'mdr-selectionLayer',
  markers: outlines,
  update(update, dom) {
    fit(dom, update.view);
    return update.docChanged || update.selectionSet || update.viewportChanged;
  },
  mount: fit,
});

/**
 * Above the text, multiplied into it on a light paper and screened on a
 * dark one, so the letters keep their colour and the selection shows the
 * same on the paper, a code block, an inline chip or a highlight.
 *
 * The colour is the accent (the ink, unfocused) at a fixed strength, set
 * with `fill-opacity` rather than `color-mix()`. Under either blend the
 * two come to the same pixels, and a WebKit without `color-mix()` would
 * have filled the outlines black over the text.
 */
const selectionTheme = EditorView.baseTheme({
  '.mdr-selectionLayer': { width: '100%', pointerEvents: 'none', mixBlendMode: 'multiply' },
  '&dark .mdr-selectionLayer': { mixBlendMode: 'screen' },
  '.mdr-selectionLayer svg': { overflow: 'visible' },
  '.mdr-selectionLayer path': {
    fill: 'var(--mdr-selection-idle, var(--mdr-fg, #1f1d1a))',
    fillOpacity: '0.11',
  },
  '&dark .mdr-selectionLayer path': { fillOpacity: '0.13' },
  '&.cm-focused .mdr-selectionLayer path': {
    fill: 'var(--mdr-selection, var(--mdr-link, #2a6ad9))',
    fillOpacity: '0.27',
  },
  '&dark.cm-focused .mdr-selectionLayer path': { fillOpacity: '0.34' },
});

/** Only in an editor that has this layer: a table cell's has neither. */
const hideDrawnSelection = EditorView.theme({
  '.cm-selectionLayer': { display: 'none' },
});

/** The selection, drawn on the text rather than across the column. */
export function textSelection(): Extension {
  return [selectionLayer, selectionTheme, hideDrawnSelection];
}
