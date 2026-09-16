import type { PagedDoc } from './document.svelte.ts';
import { type FindOptions, hitsInPage, type PagedHit, queryRegExp } from './find.ts';

/**
 * The find bar's state over a PDF (ADR 0035).
 *
 * A document search is one call into CodeMirror because the whole buffer
 * is in hand. A PDF's text arrives a page at a time from the worker, so
 * this walks the pages, keeps what it finds, and lets the reader step
 * through it while the walk is still going — the same bargain Read mode
 * makes with a long document.
 */
export class PagedSearch {
  hits = $state<PagedHit[]>([]);
  /** Which hit the reader is on, as an index. -1 before they step. */
  at = $state(-1);
  /** True while pages are still being read. The bar shows `n+`. */
  running = $state(false);
  /** Bumped on every new query, so an old walk drops what it finds. */
  private generation = 0;
  private query = '';

  /** Give up on what is running and forget it. */
  clear(): void {
    this.generation += 1;
    this.hits = [];
    this.at = -1;
    this.running = false;
    this.query = '';
  }

  /**
   * Search a document. Returns once every page has been read; the hits
   * appear as they are found, so the bar counts up rather than waiting.
   */
  async run(paged: PagedDoc, query: string, options: FindOptions = {}): Promise<void> {
    const pattern = queryRegExp(query, options);
    if (pattern === null) {
      this.clear();
      return;
    }
    this.generation += 1;
    const mine = this.generation;
    this.query = query;
    this.hits = [];
    this.at = -1;
    this.running = true;
    const found: PagedHit[] = [];
    // `pages` is a floor while the engine is still laying the document
    // out (ADR 0042), so the walk catches up with it and then waits for
    // the rest, rather than answering for the pages there happened to
    // be when the reader started typing.
    let page = 1;
    for (;;) {
      for (; page <= paged.pages; page++) {
        const runs = await paged.text(page);
        // The reader typed another letter, and these are answers to the
        // question before it.
        if (this.generation !== mine) return;
        const pageHits = hitsInPage(runs, page, pattern);
        if (pageHits.length > 0) {
          found.push(...pageHits);
          // A new array each time: the bar watches the reference.
          this.hits = [...found];
        }
      }
      if (paged.complete) break;
      await paged.whenLaidOut();
      if (this.generation !== mine) return;
    }
    this.running = false;
  }

  /** Whether this is still the answer to the question being asked. */
  matches(query: string): boolean {
    return this.query === query;
  }
}
