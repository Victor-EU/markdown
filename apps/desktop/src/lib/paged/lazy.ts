import type { OpenOptions, PagedDocument, PageEngine } from './engine.ts';

/**
 * An engine loaded the first time a file asks for it (ADR 0035).
 *
 * pdf.js is a megabyte of code and four of data, and the Office engine
 * is more; most launches of a markdown reader never meet either. Read
 * mode makes the same bargain with Shiki, KaTeX and Mermaid: the port is
 * handed over at startup and the library behind it arrives when
 * something asks for it.
 *
 * This is also the only reason the shell can be built without any of
 * them in its first chunk while still holding a `PageEngine` for every
 * format from the beginning — the port is what makes a stand-in like
 * this possible at all.
 */
export function lazyEngine(load: () => Promise<PageEngine>): PageEngine {
  let engine: Promise<PageEngine> | null = null;
  return {
    async open(url: string, options?: OpenOptions): Promise<PagedDocument> {
      engine ??= load();
      return (await engine).open(url, options);
    },
    destroy(): void {
      void engine?.then((loaded) => loaded.destroy());
      engine = null;
    },
  };
}
