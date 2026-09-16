import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Put the Office engine's WebAssembly where the page can fetch it (ADR
 * 0042), on the terms `pdfjs-assets.ts` set for pdf.js's data.
 *
 * The library finds its parsers with `new URL('…wasm', import.meta.url)`,
 * which points into wherever the bundler put the chunk that asked — and
 * under Vite's dependency pre-bundling that is a folder the file was
 * never copied to. The library takes a `wasmUrl` instead, so the two
 * parsers are copied here at build time and the adapters name them by
 * a path that is the same in every build: `public/paged/` is in
 * `.gitignore` for the same reason `public/pdfjs/` is, and the version
 * is written beside the copy so a stale one is noticed rather than
 * trusted.
 *
 * It runs from `config`, before Vite decides how to serve `public/`;
 * see `pdfjs-assets.ts` for why `buildStart` is too late.
 */
const FILES = ['docx_parser_bg.wasm', 'pptx_parser_bg.wasm'] as const;
const NOTICES = ['LICENSE', 'THIRD_PARTY_NOTICES.md'] as const;
const STAMP = '.version';

export function officeAssets(): Plugin {
  return {
    name: 'markdown:office-assets',
    config() {
      const require = createRequire(import.meta.url);
      // The package's `exports` map does not expose its manifest, so
      // the root is found from an entry it does expose.
      const from = dirname(dirname(require.resolve('@silurus/ooxml/docx')));
      const to = join(import.meta.dirname, 'public', 'paged');
      const version = String(JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version);
      const stamp = join(to, STAMP);
      if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) return;
      rmSync(to, { recursive: true, force: true });
      mkdirSync(to, { recursive: true });
      for (const name of FILES) cpSync(join(from, 'dist', name), join(to, name));
      for (const name of NOTICES) cpSync(join(from, name), join(to, name));
      if (!existsSync(join(to, FILES[0]))) {
        throw new Error('@silurus/ooxml did not copy; Word and PowerPoint files will not render');
      }
      writeFileSync(stamp, version);
    },
  };
}
