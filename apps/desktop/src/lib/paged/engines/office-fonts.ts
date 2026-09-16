import caladeaItalic from '@fontsource/caladea/files/caladea-latin-400-italic.woff2?url';
import caladea from '@fontsource/caladea/files/caladea-latin-400-normal.woff2?url';
import caladeaBoldItalic from '@fontsource/caladea/files/caladea-latin-700-italic.woff2?url';
import caladeaBold from '@fontsource/caladea/files/caladea-latin-700-normal.woff2?url';
import carlitoItalic from '@fontsource/carlito/files/carlito-latin-400-italic.woff2?url';
import carlito from '@fontsource/carlito/files/carlito-latin-400-normal.woff2?url';
import carlitoBoldItalic from '@fontsource/carlito/files/carlito-latin-700-italic.woff2?url';
import carlitoBold from '@fontsource/carlito/files/carlito-latin-700-normal.woff2?url';

/**
 * Word's fonts, on a Mac that does not have them (ADR 0042).
 *
 * Nearly every Office file names Calibri or Cambria, and Apple ships
 * neither; Office keeps its own copies inside its bundle where no other
 * app can see them. A renderer that lays text out itself then measures
 * whatever the platform substitutes, and line breaks and page counts
 * drift from Word's by the difference. Carlito and Caladea are the
 * metric-compatible faces made for exactly this — the same widths, so
 * the same breaks — and they are registered here under the names the
 * documents use, with `local()` first so a Mac that does have the real
 * font draws it.
 *
 * Only the Latin subsets, only the four faces a document ordinarily
 * uses, about seven hundred kilobytes, and only fetched by a build that
 * reaches an adapter: the adapters await this before their engine lays
 * a page out, because the layout measures the fonts the page will be
 * painted in. Aptos, Office's default since 2023, has no metric clone
 * and gets what the stack gives it.
 */
const FACES: [family: string, url: string, weight: string, style: string][] = [
  ['Calibri', carlito, '400', 'normal'],
  ['Calibri', carlitoBold, '700', 'normal'],
  ['Calibri', carlitoItalic, '400', 'italic'],
  ['Calibri', carlitoBoldItalic, '700', 'italic'],
  ['Cambria', caladea, '400', 'normal'],
  ['Cambria', caladeaBold, '700', 'normal'],
  ['Cambria', caladeaItalic, '400', 'italic'],
  ['Cambria', caladeaBoldItalic, '700', 'italic'],
];

let ready: Promise<void> | null = null;

/** The stand-ins, registered and loaded, once. Never rejects. */
export function officeFontsReady(): Promise<void> {
  ready ??= (async () => {
    if (typeof FontFace === 'undefined' || !('fonts' in document)) return;
    const faces = FACES.map(
      ([family, url, weight, style]) =>
        new FontFace(family, `local("${family}"), url("${url}") format("woff2")`, {
          weight,
          style,
        }),
    );
    for (const face of faces) document.fonts.add(face);
    // A face that will not load is a page in the platform's own
    // substitute, which is what it would have been anyway.
    await Promise.all(faces.map((face) => face.load().catch(() => undefined)));
  })();
  return ready;
}

/** For tests: the families this registers. */
export const OFFICE_FONT_FAMILIES = ['Calibri', 'Cambria'] as const;
