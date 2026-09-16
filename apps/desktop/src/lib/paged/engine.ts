/**
 * The page engine port (ADR 0035, widened by ADR 0042).
 *
 * No pdf.js type may appear in this file, and neither may the library's
 * name: `single-import.test.ts` reads that literally. It is the whole of
 * what the shell is allowed to know about rendering a paged document —
 * a PDF, and from ADR 0042 a Word document or a deck — and it is
 * written to be satisfiable by more than one library: pdf.js is the
 * engine we chose for PDF, PDFium is the one we might choose later, and
 * the point of the seam is that a format is one adapter behind it
 * rather than anything in the shell.
 *
 * Three properties of this interface are deliberate.
 *
 * It renders into a canvas the *caller* owns, because the caller is what
 * knows about virtualization and device pixel ratio, and because both
 * candidate engines rasterize to a bitmap. It measures in points rather
 * than pixels, because points are what a PDF is written in and pixels
 * are what a zoom level makes of them — putting the conversion on one
 * side of the line keeps the other side honest. And `text()` returns
 * runs with geometry rather than a rendered DOM layer, because pdf.js's
 * `TextLayerBuilder` and PDFium's text extraction agree on that shape
 * and disagree on everything above it.
 *
 * What it deliberately does not carry: annotations, forms, editing,
 * printing, or anything that would make it a description of pdf.js
 * rather than of PDF viewing. A port wide enough to express one
 * library's whole surface is not a port.
 */

/** A page's intrinsic size, in PDF points (1/72 inch). */
export interface PageSize {
  width: number;
  height: number;
}

/** One bookmark in a document's own table of contents. */
export interface PagedOutlineEntry {
  level: number;
  text: string;
  page: number;
}

export interface RenderRequest {
  /** One-based, the way a PDF numbers its own pages. */
  page: number;
  /** CSS pixels per point, so the caller owns zoom and device ratio. */
  scale: number;
  canvas: HTMLCanvasElement;
  /** A page scrolled out of the window cancels rather than finishing. */
  signal?: AbortSignal;
}

/** A run of text and where it sits, for the selection layer. */
export interface TextRun {
  text: string;
  /** Left, top, width, height, in points from the page's top-left. */
  rect: readonly [number, number, number, number];
}

/** What `open` may be told beside the URL. */
export interface OpenOptions {
  /**
   * Called as pages are laid out, by an engine that lays a document out
   * progressively rather than whole (ADR 0042): `pages` is how many can
   * be drawn so far, and `complete` is true exactly once, when the count
   * is final. An engine that has every page before `open` resolves never
   * calls it, and its `pages` is final from the start. The two
   * behaviours look the same to a caller that treats `pages` as a floor
   * until told otherwise, which is what the shell does.
   */
  onPages?: (pages: number, complete: boolean) => void;
}

export interface PagedDocument {
  /** How many pages so far. Final, unless `open` was told it would grow. */
  readonly pages: number;
  size(page: number): Promise<PageSize>;
  render(request: RenderRequest): Promise<void>;
  text(page: number): Promise<TextRun[]>;
  outline(): Promise<PagedOutlineEntry[]>;
  destroy(): void;
}

export interface PageEngine {
  /**
   * The URL is the asset protocol's; the engine fetches it itself.
   * Resolves once the first page can be drawn, which for an engine that
   * lays out progressively is before the last one can.
   */
  open(url: string, options?: OpenOptions): Promise<PagedDocument>;
  destroy(): void;
}

/**
 * Why a document would not open, in terms the status bar can use.
 *
 * A password is its own case rather than a corruption because it is the
 * one the reader can do something about, and `too_large` is its own
 * because it is a limit this app chose rather than anything wrong with
 * the file.
 */
export type PagedFailure = 'password' | 'corrupt' | 'too_large' | 'unavailable';

export class PagedError extends Error {
  constructor(
    readonly reason: PagedFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PagedError';
  }
}

/**
 * What the status bar says when a file will not open. `noun` is the
 * format's own word for itself — "PDF", "document", "deck" — because
 * "is not a readable PDF" over a deck is a lie in a status bar.
 */
export function describePagedError(error: unknown, name: string, noun = 'PDF'): string {
  if (!(error instanceof PagedError)) return `${name} could not be opened`;
  switch (error.reason) {
    case 'password':
      return `${name} is password protected`;
    case 'too_large':
      return `${name} is too large to open`;
    case 'corrupt':
      return `${name} is not a readable ${noun}`;
    default:
      return `${name} could not be opened`;
  }
}
