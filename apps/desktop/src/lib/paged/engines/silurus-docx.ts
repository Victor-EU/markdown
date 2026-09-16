import { DocxDocument, OoxmlResourceLimitError } from '@silurus/ooxml/docx';
import { math } from '@silurus/ooxml/math';
import {
  type OpenOptions,
  type PagedDocument,
  PagedError,
  type PagedFailure,
  type PagedOutlineEntry,
  type PageEngine,
  type PageSize,
  type RenderRequest,
  type TextRun,
} from '../engine.ts';

/**
 * The Word engine, behind the port (ADR 0042).
 *
 * This file and `silurus-pptx.ts` are the only two that may name
 * `@silurus/ooxml`; `single-import.test.ts` reads that literally. The
 * library parses the file in a worker it makes from a blob, lays the
 * pages out with its own paginator, and paints them to a canvas the
 * caller owns — which is the port's shape already, so what this file
 * does is translate units and indices and nothing else: the port
 * counts pages from one and measures in points, the library counts
 * from zero and answers in points too, and its runs come back at
 * whatever width they were asked for, which is the page's own.
 *
 * Layout is progressive. `load` resolves when the opening pages can be
 * painted and the paginator carries on behind it, so a long document
 * shows its first page in well under a second rather than after every
 * page has been laid out (the thesis in the research note took 3.4 s
 * whole and 0.7 s this way). The port's `onPages` is how that reaches
 * the shell: a floor as pages arrive, and `complete` once.
 */

/** The parser's WebAssembly, copied out of the package by `office-assets.ts`. */
const WASM_URL = '/paged/docx_parser_bg.wasm';

/**
 * What an untrusted file may cost, beyond the 64 MB Rust already caps
 * the file itself at (design 8). A zip bomb is a small file that
 * inflates to gigabytes; a document that hangs the parser is a worker
 * that never answers. Both become a failure the status bar can name.
 */
const LIMITS = {
  resourceLimits: { maxTotalInflatedBytes: 512_000_000, maxArchiveEntries: 20_000 },
  maxZipEntryBytes: 256_000_000,
  workerTimeoutMs: 60_000,
} as const;

/**
 * The port's four reasons, from what the library throws at `load`.
 *
 * A password is the one the reader can do something about, and a limit
 * is this app's own choice, so both are named; a worker that never
 * answered is the engine's problem, not the file's. Everything else a
 * failed load can be — a text file wearing the extension, a truncated
 * download, a `.doc` renamed — is a file this engine cannot read, and
 * the library reports those from wherever it happened to give up (a
 * non-zip fails in layout, with "page size must be positive"), so the
 * stage is not something to sort by.
 */
export function failureOf(error: unknown): PagedFailure {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'encrypted':
    case 'invalid-password':
    case 'unsupported-encryption':
      return 'password';
    case 'not-ooxml':
    case 'legacy-binary-format':
      return 'corrupt';
    default:
      break;
  }
  if (error instanceof OoxmlResourceLimitError) return 'too_large';
  const message = error instanceof Error ? error.message : String(error);
  return /timed? ?out|timeout|worker/i.test(message) ? 'unavailable' : 'corrupt';
}

function translate(error: unknown): PagedError {
  if (error instanceof PagedError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PagedError(failureOf(error), message);
}

class SilurusDocxDocument implements PagedDocument {
  private destroyed = false;

  constructor(private readonly doc: DocxDocument) {}

  /** A floor until the paginator has finished; the shell treats it as one. */
  get pages(): number {
    return this.doc.pageCount;
  }

  async size(page: number): Promise<PageSize> {
    const { widthPt, heightPt } = this.doc.pageSize(page - 1);
    return { width: widthPt, height: heightPt };
  }

  async render({ page, scale, canvas, signal }: RenderRequest): Promise<void> {
    if (signal?.aborted || this.destroyed) return;
    const { widthPt } = this.doc.pageSize(page - 1);
    // `scale` is CSS pixels per point with the device ratio already in
    // it. The library sizes the canvas itself, bitmap and CSS box both,
    // from a CSS width and a ratio — so the two are split back out, and
    // the box the view had set is put back afterwards, because the view
    // owns it (the first bundle drew every page twice its size for want
    // of this). There is no cancelling a render once begun; one
    // abandoned finishes into a canvas the view has already given back,
    // which is what pdf.js does with a cancelled task too.
    const dpr = globalThis.devicePixelRatio || 1;
    const { width, height } = canvas.style;
    await this.doc.renderPage(canvas, page - 1, { width: (widthPt * scale) / dpr, dpr });
    canvas.style.width = width;
    canvas.style.height = height;
  }

  async text(page: number): Promise<TextRun[]> {
    const { widthPt } = this.doc.pageSize(page - 1);
    // Asked at the page's own width in points, the runs come back in
    // points, which is what the selection layer and Find expect.
    const runs = await this.doc.collectPageRuns(page - 1, { width: widthPt });
    return runs.map((run) => ({ text: run.text, rect: [run.x, run.y, run.w, run.h] as const }));
  }

  async outline(): Promise<PagedOutlineEntry[]> {
    // A heading list is not exposed as one; the bookmarks are, and a
    // later package may build headings from the runs (ADR 0042).
    return [];
  }

  destroy(): void {
    this.destroyed = true;
    this.doc.destroy();
  }
}

export class SilurusDocxEngine implements PageEngine {
  async open(url: string, options?: OpenOptions): Promise<PagedDocument> {
    let doc: DocxDocument | null = null;
    try {
      doc = await DocxDocument.load(url, {
        math,
        wasmUrl: WASM_URL,
        progressiveLayout: true,
        ...LIMITS,
        // Pages as they are laid out. `doc` is null until `load`
        // resolves, and what is reported before that is reported again
        // after it, from the document itself.
        onLayoutProgress: () => {
          if (doc) options?.onPages?.(doc.pageCount, false);
        },
      });
    } catch (error) {
      throw translate(error);
    }
    const opened = doc;
    if (!opened.layoutComplete) {
      options?.onPages?.(opened.pageCount, false);
      // The final count, once. Not awaited: `open` resolves with the
      // pages there are, which is the point of laying out progressively.
      void opened
        .waitUntilLayoutComplete()
        .catch(() => {})
        .then(() => options?.onPages?.(opened.pageCount, true));
    }
    return new SilurusDocxDocument(opened);
  }

  destroy(): void {}
}
