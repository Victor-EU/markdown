import type { PagedDocument, PageEngine } from './engine.ts';

/**
 * The engine, loaded the first time a PDF is opened (ADR 0035).
 *
 * pdf.js is a megabyte of code and four of data, and most launches of a
 * markdown reader never meet a PDF. Read mode makes the same bargain
 * with Shiki, KaTeX and Mermaid: the port is handed over at startup and
 * the library behind it arrives when something asks for it.
 *
 * This is also the only reason the shell can be built without pdf.js in
 * its first chunk while still holding a `PageEngine` from the beginning —
 * the port is what makes a stand-in like this possible at all.
 */
export function lazyPageEngine(): PageEngine {
  let engine: PageEngine | null = null;
  return {
    async open(url: string): Promise<PagedDocument> {
      if (!engine) {
        const { PdfJsEngine } = await import('./engines/pdfjs.ts');
        engine = new PdfJsEngine();
      }
      return engine.open(url);
    },
    destroy(): void {
      engine?.destroy();
      engine = null;
    },
  };
}
