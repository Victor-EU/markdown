import type { PageEngine } from './engine.ts';
import { lazyEngine } from './lazy.ts';

/**
 * What a paged tab can be (ADR 0042).
 *
 * This is the one list. A format is an entry here and an adapter under
 * `engines/`, and nothing else: not the pane, not the session, not
 * Rust, which takes charge of any of these files with the same
 * `open_paged` and never learns which is which. The path's extension is
 * what says, here and nowhere else.
 */
export type FormatId = 'pdf' | 'docx' | 'pptx';

export interface PagedFormat {
  readonly id: FormatId;
  /** Lower-case, without the dot. */
  readonly extensions: readonly string[];
  /** What the status bar counts: "41 pages", "10 slides". */
  readonly unit: 'page' | 'slide';
  /** The noun in "is not a readable …". */
  readonly noun: string;
  /** The Cmd+O filter it is listed under; formats may share one. */
  readonly filter: string;
}

export const FORMATS: readonly PagedFormat[] = [
  { id: 'pdf', extensions: ['pdf'], unit: 'page', noun: 'PDF', filter: 'PDF' },
  { id: 'docx', extensions: ['docx'], unit: 'page', noun: 'document', filter: 'Office documents' },
];

/**
 * The library behind each format, loaded the first time a file of that
 * format opens — the bargain Read mode makes with Shiki, KaTeX and
 * Mermaid, and the reason a markdown session never pays for any of
 * these. Kept apart from the list above because the list is data the
 * shell and the tests read, and this is code only a Tauri build runs:
 * a browser build has no asset protocol to read a file over.
 */
const ENGINES: Partial<Record<FormatId, () => Promise<PageEngine>>> = {
  pdf: () => import('./engines/pdfjs.ts').then((m) => new m.PdfJsEngine()),
  docx: () => import('./engines/silurus-docx.ts').then((m) => new m.SilurusDocxEngine()),
};

/** The format a path names, by extension, or null for a document. */
export function formatOf(
  path: string,
  formats: readonly PagedFormat[] = FORMATS,
): PagedFormat | null {
  const at = path.lastIndexOf('.');
  if (at === -1 || Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) > at) return null;
  const extension = path.slice(at + 1).toLowerCase();
  return formats.find((format) => format.extensions.includes(extension)) ?? null;
}

/**
 * What Cmd+O offers beside markdown: one entry per filter label, with
 * every extension that label covers. Formats that share a label share
 * an entry, so "Office documents" lists both of its kinds under one
 * name rather than two entries a reader has to choose between.
 */
export function openFilters(
  formats: readonly PagedFormat[] = FORMATS,
): { name: string; extensions: string[] }[] {
  const filters: { name: string; extensions: string[] }[] = [];
  for (const format of formats) {
    const held = filters.find((filter) => filter.name === format.filter);
    if (held) held.extensions.push(...format.extensions);
    else filters.push({ name: format.filter, extensions: [...format.extensions] });
  }
  return filters;
}

/** Every engine there is, each loaded on first use. */
export function lazyEngines(): Partial<Record<FormatId, PageEngine>> {
  const engines: Partial<Record<FormatId, PageEngine>> = {};
  for (const [id, load] of Object.entries(ENGINES) as [FormatId, () => Promise<PageEngine>][]) {
    engines[id] = lazyEngine(load);
  }
  return engines;
}
