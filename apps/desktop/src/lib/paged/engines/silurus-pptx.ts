import { math } from '@silurus/ooxml/math';
import { PptxPresentation, type PptxTextRunInfo } from '@silurus/ooxml/pptx';
import {
  type OpenOptions,
  type PagedDocument,
  PagedError,
  type PagedOutlineEntry,
  type PageEngine,
  type PageSize,
  type RenderRequest,
  type TextRun,
} from '../engine.ts';
import { officeFontsReady } from './office-fonts.ts';
import { failureOf, ooxmlBytes } from './silurus-docx.ts';

/**
 * The PowerPoint engine, behind the port (ADR 0042).
 *
 * The other of the two files that may name `@silurus/ooxml`. A deck is
 * a paged document whose pages are all one size and all known from the
 * start — a presentation's slide list is in its manifest, so there is
 * no progressive count to report, only slides to paint. What differs
 * from the Word adapter is the units: the library answers a deck's
 * geometry in EMU, the OOXML unit of which there are 12,700 to the
 * point, both for the slide's size and for where its text runs sit.
 */

/** English Metric Units to the point. */
const EMU_PER_POINT = 12_700;
/**
 * The width `collectSlideRuns` renders at when it is not told one. The
 * runs come back in EMU, which is the slide's own unit and not the
 * raster's, so this decides how much painting the measurement costs
 * and nothing about the answer.
 */
const RUN_WIDTH = 960;
const WASM_URL = '/paged/pptx_parser_bg.wasm';
const LIMITS = {
  resourceLimits: { maxTotalInflatedBytes: 512_000_000, maxArchiveEntries: 20_000 },
  maxZipEntryBytes: 256_000_000,
  workerTimeoutMs: 60_000,
} as const;

class SilurusPptxDocument implements PagedDocument {
  private destroyed = false;

  constructor(private readonly deck: PptxPresentation) {}

  get pages(): number {
    return this.deck.slideCount;
  }

  async size(): Promise<PageSize> {
    return {
      width: this.deck.slideWidth / EMU_PER_POINT,
      height: this.deck.slideHeight / EMU_PER_POINT,
    };
  }

  async render({ page, scale, canvas, signal }: RenderRequest): Promise<void> {
    if (signal?.aborted || this.destroyed) return;
    const widthPt = this.deck.slideWidth / EMU_PER_POINT;
    // The same split as the Word adapter, for the same reason: the
    // library sizes the canvas's CSS box itself, and the view owns it.
    const dpr = globalThis.devicePixelRatio || 1;
    const { width, height } = canvas.style;
    await this.deck.renderSlide(canvas, page - 1, { width: (widthPt * scale) / dpr, dpr });
    canvas.style.width = width;
    canvas.style.height = height;
  }

  async text(page: number): Promise<TextRun[]> {
    const runs: PptxTextRunInfo[] = [];
    // `collectSlideRuns` is this, three lines shorter: it renders the
    // slide and keeps the runs the renderer reports. What it renders
    // into is an `OffscreenCanvas`, and not every WebKit this app runs
    // on has one — Safari gained it in 16.4, so a Mac on the 12.0
    // floor has not, and neither has the WebKit that Playwright builds
    // for Windows, which is how this was found. A detached canvas
    // element measures the same and exists everywhere.
    const scratch = document.createElement('canvas');
    try {
      await this.deck.renderSlide(scratch, page - 1, {
        width: RUN_WIDTH,
        onTextRun: (run) => runs.push(run),
      });
    } finally {
      // Megabytes of pixels nobody will look at: let go of them now
      // rather than whenever the collector gets round to it.
      scratch.width = 0;
      scratch.height = 0;
    }
    // A run's place is its shape's place plus its own inside the shape,
    // all in EMU whatever width the slide was drawn at.
    return runs.map((run) => ({
      text: run.text,
      rect: [
        (run.shapeX + run.inShapeX) / EMU_PER_POINT,
        (run.shapeY + run.inShapeY) / EMU_PER_POINT,
        run.w / EMU_PER_POINT,
        run.h / EMU_PER_POINT,
      ] as const,
    }));
  }

  async outline(): Promise<PagedOutlineEntry[]> {
    // Slide titles are in the runs; a later package may make them an
    // outline (ADR 0042).
    return [];
  }

  destroy(): void {
    this.destroyed = true;
    this.deck.destroy();
  }
}

export class SilurusPptxEngine implements PageEngine {
  async open(url: string, _options?: OpenOptions): Promise<PagedDocument> {
    let deck: PptxPresentation;
    try {
      // The fonts first, because layout measures them (WP 5).
      await officeFontsReady();
      const bytes = await ooxmlBytes(url);
      deck = await PptxPresentation.load(bytes, { math, wasmUrl: WASM_URL, ...LIMITS });
      await deck.waitUntilLayoutComplete();
    } catch (error) {
      if (error instanceof PagedError) throw error;
      throw new PagedError(
        failureOf(error),
        error instanceof Error ? error.message : String(error),
      );
    }
    // A deck with nothing in it is nothing to show.
    if (deck.slideCount === 0) {
      deck.destroy();
      throw new PagedError('corrupt', 'no slides in the file');
    }
    return new SilurusPptxDocument(deck);
  }

  destroy(): void {}
}
