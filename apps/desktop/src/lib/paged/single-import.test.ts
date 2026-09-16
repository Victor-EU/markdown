import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One file per format may import the library behind it, and this is
 * what holds it to that (ADR 0035, ADR 0042).
 *
 * The rule is easy to break by accident — a type import for
 * convenience, a constant borrowed from the library — and each break
 * costs nothing at all until the day the engine is swapped, when it
 * costs everything. The `Enhancer` port has the same shape and has held
 * on intention alone; this one is worth enforcing because the thing it
 * keeps out is bigger.
 *
 * Only source directories are walked. The Vite plugin that copies the
 * library's data out of `node_modules`, and the test runner's
 * `optimizeDeps` list, both have to name the package and both sit
 * outside `src/`, which is the line this draws.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const SKIP = new Set(['node_modules', 'target', 'dist', 'public', '.git', '.vitest', 'corpus']);
const CODE = /\.(ts|mts|js|mjs|svelte)$/;
const PAGED = join('apps', 'desktop', 'src', 'lib', 'paged');
const PORT = join(PAGED, 'engine.ts');
const SELF = join(PAGED, 'single-import.test.ts');
const ADAPTER = join(PAGED, 'engines', 'pdfjs.ts');

/**
 * Each library a page engine is built on, and the only files that may
 * name it (ADR 0042). A format is one adapter here and one line in the
 * registry, and this table is what keeps it that way.
 */
const LIBRARIES = [
  {
    package: 'pdfjs-dist',
    adapters: [ADAPTER],
    plugin: join('apps', 'desktop', 'pdfjs-assets.ts'),
  },
  {
    package: '@silurus/ooxml',
    adapters: [join(PAGED, 'engines', 'silurus-docx.ts')],
    plugin: join('apps', 'desktop', 'office-assets.ts'),
  },
];

/** Every source file in the workspace, as paths relative to the root. */
function sources(dir: string, inSrc: boolean, into: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, inSrc || entry.name === 'src', into);
    else if (inSrc && CODE.test(entry.name)) into.push(relative(ROOT, path));
  }
  return into;
}

/**
 * What a file imports. Static and dynamic both, because a lazy import
 * of the library is exactly the shape the rule has to catch.
 */
function imports(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const found = [...source.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)];
  return found.map((match) => match[1] as string);
}

describe.each(LIBRARIES)(
  '$package is imported only by its adapters',
  ({ package: name, adapters, plugin }) => {
    const files = sources(ROOT, false, []);

    it('finds the source tree it is meant to be walking', () => {
      // A walk that silently found nothing would pass every other test
      // here, which is the one way this file could stop doing its job.
      for (const adapter of adapters) expect(files).toContain(adapter);
      expect(files).toContain(PORT);
      expect(files.length).toBeGreaterThan(50);
    });

    it('is imported nowhere else', () => {
      const importing = files.filter((file) =>
        imports(file).some((specifier) => specifier === name || specifier.startsWith(`${name}/`)),
      );
      expect(importing.sort()).toEqual([...adapters].sort());
    });

    it('leaves no library type in the port itself', () => {
      // The port is what the shell is allowed to know, and it is written
      // to be satisfiable by more than one library. A library's type in it
      // would make it a description of that library rather than of paged
      // documents.
      expect(readFileSync(join(ROOT, PORT), 'utf8')).not.toContain(name);
    });

    it('walks past the build plumbing, which is allowed to name it', () => {
      // Naming the exemption here rather than in `SKIP` keeps it visible.
      expect(readFileSync(join(ROOT, plugin), 'utf8')).toContain(name);
      expect(files).not.toContain(plugin);
      expect(plugin.split(sep)).not.toContain('src');
      // This file names the packages all over, and is the enforcement
      // rather than a use of them; it passes only because it imports none.
      expect(files).toContain(SELF);
      expect(imports(SELF).filter((s) => s.startsWith(name))).toEqual([]);
    });
  },
);

describe('the pdf.js adapter', () => {
  it('imports from the library rather than from its viewer', () => {
    // `pdfjs-dist/web/` is the bundled viewer, and it is how a PDF's own
    // JavaScript would come back: scripting runs in `pdf.sandbox.mjs`,
    // which only the viewer loads. The core API has no annotation layer
    // and so no scripting path at all, which is the durable answer to
    // CVE-2026-16633.
    const specifiers = imports(ADAPTER).filter((s) => s.startsWith('pdfjs-dist'));
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^pdfjs-dist(\/build\/.+)?$/);
    }
  });
});
