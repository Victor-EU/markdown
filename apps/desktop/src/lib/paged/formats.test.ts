import { describe, expect, it } from 'vitest';
import { FORMATS, formatOf, openFilters, type PagedFormat } from './formats.ts';

/** The registry with a second format in it, the shape WP 4 adds. */
const WITH_DECKS: readonly PagedFormat[] = [
  ...FORMATS,
  { id: 'pptx', extensions: ['pptx'], unit: 'slide', noun: 'deck', filter: 'Office documents' },
];

describe('the format a path names (ADR 0042)', () => {
  it('reads the extension, whatever its case', () => {
    expect(formatOf('/a/paper.pdf')?.id).toBe('pdf');
    expect(formatOf('/a/PAPER.PDF')?.id).toBe('pdf');
    expect(formatOf('C:\\docs\\Paper.PDF')?.id).toBe('pdf');
    expect(formatOf('/a/deck.pptx', WITH_DECKS)?.id).toBe('pptx');
  });

  it('is asked of a path, before anything has been read', () => {
    // A file whose name says nothing opens as a document, which is what
    // it has always done (ADR 0035).
    expect(formatOf('/a/notes.md')).toBeNull();
    expect(formatOf('/a/pdf')).toBeNull();
    expect(formatOf('/a/paper.pdf.md')).toBeNull();
    expect(formatOf('/a.b/paper')).toBeNull();
    expect(formatOf('/a/deck.pptx')).toBeNull();
  });
});

describe('what Cmd+O offers', () => {
  it('lists each format under its filter, sharing a label between kinds', () => {
    expect(openFilters(WITH_DECKS)).toEqual([
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Office documents', extensions: ['docx', 'pptx'] },
    ]);
  });
});
