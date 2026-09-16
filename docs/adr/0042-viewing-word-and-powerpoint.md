# ADR 0042: Viewing Word and PowerPoint files

Status: accepted, 2026-09-16; being built on the `office-viewing` branch,
one commit per work package. What building it changed is at the end,
under "As built". The research and the
spike that chose the library are in [docs/office-viewing.md](../office-viewing.md)
and `spikes/office-viewing/`; this is the plan for putting it in, in the
shape of ADR 0035, which it leans on for everything.

## Why now, and what it is not

An AI's deliverable for other humans is increasingly a Word file or a
deck. The human reads it, tells the AI what to change, and the AI
changes it; only at the last step does the file go into Word or
PowerPoint for precise editing. That is the PDF case again: not a
document the app edits or hands to a model, but the human's side of a
review. So a docx or a pptx opens the way a PDF opens — pages one under
another, Find, zoom, a place in the session — and nothing else. No
slide sorter, no notes pane, no editing, no export. PowerPoint and Canva
are for the last step; this app is for the loop before it.

Design section 12 keeps "export to PDF or DOCX" among the things that
wait. This ADR does not touch export.

## The decision that makes it cheap

ADR 0035 built a port, `PdfDocument`, that asks for a page count, a
page's size in points, a render into a canvas the caller owns, the text
runs with their rectangles, and an outline. Nothing in that is about
PDF. `PdfDoc`, `PdfView`, `find.ts` and `PdfPane.svelte` consume only
the port, and Find, zoom, the status bar, session restore and moving a
tab between windows all work through it. The spike showed that
`@silurus/ooxml`'s headless `DocxDocument` and `PptxPresentation`
satisfy that port with a translation of units and indices and nothing
else.

So the plan is not a new pane. It is: admit that the port describes a
paged document, give the shell one word for such a tab, and make a
format a *data entry plus one adapter file*. After the docx package,
the pptx package is the proof: it must touch no Rust, no session
format, no pane, no Find, and no test outside its own.

That is what "plug and play" means here, precisely: adding a format
later is one line in a registry, one adapter file that is the only
importer of its library, one fixture, and one row in the notices. If a
fourth format ever needs more than that, the seam has failed and this
ADR is wrong.

## The library

`@silurus/ooxml`, MIT, pinned exactly. Rust parsers in WebAssembly, a
layout engine that paginates like Word, canvas painting, and headless
classes with the port's shape. Chosen over `docx-preview` (does not
paginate by flow) and over `@aiden0z/pptx-renderer` (DOM output that
would need its own pane, and it lost on a human-made deck). Weight, both
formats, 8.4 MB raw and 2.7 MB gzipped, loaded on first use like pdf.js;
equations another 3 MB, loaded only by a document that has one. The
full comparison is in the research note.

Facts from the probes that shape the design (all in Playwright's WebKit
26.6, `spikes/office-viewing/probe.mjs`):

- **It works under the app's CSP as written.** The library makes one
  worker, from a `blob:` URL, and WebKit made it under
  `script-src 'self' 'wasm-unsafe-eval'` with no violation. Chromium
  enforces `worker-src` for `blob:`, so the policy gains
  `worker-src 'self' blob:` for WebView2's sake, and the first build day
  checks the running app rather than a probe. `img-src` needs nothing:
  the blob the earlier network log showed was the worker script.
- **Text runs.** For docx, `collectPageRuns(i, { width: widthPt })`
  returns runs in points. For pptx, `collectSlideRuns(i)` returns EMU
  whatever width is passed, and `slideWidth` is EMU too: the adapter
  divides by 12700.
- **Progressive layout.** `progressiveLayout: true` resolves `load()`
  for the 41-page thesis at 0.5 s with 3 pages laid out, draws page 1 at
  0.7 s, and finishes at 3.2 s with 41; without it, nothing before
  3.4 s. So the port has to let a page count grow.
- **The font shim is honoured during layout.** Carlito registered as
  `"Calibri"` through `FontFace` changed line positions in the memo and
  the thesis's page count from 41 to 40. The library asks the canvas for
  `Calibri` first, so no library change is needed, only fonts loaded
  before `load()`.
- **Errors** come as `OoxmlError` with a `code`: `encrypted`,
  `invalid-password`, `unsupported-encryption`, `legacy-binary-format`
  (a `.doc` or `.ppt`), `not-ooxml`. They map onto the port's four
  reasons without a new one.
- **Limits** exist for the untrusted-file case: `resourceLimits`
  (inflated bytes, entry count), `maxZipEntryBytes`, and
  `workerTimeoutMs`, which turns a file that hangs the parser into a
  failure the status bar can name.

## The shape

### One kind of tab: `paged`

`TabKind::Pdf` becomes `TabKind::Paged`, with `#[serde(alias = "pdf")]`
so a session written by 0.2.0 still opens its PDFs. A 0.2.0 reading a
newer session drops a `paged` tab the way ADR 0035's lenient reader
drops any kind it does not know, and keeps the rest.

This is the one place the plan departs from ADR 0035's "a tab says what
it is showing". A docx tab and a pptx tab share the pane, the port, the
place, Find, zoom and the session shape; they differ in the status
bar's noun and in what the engine can offer. The path already says
which is which. Three kinds would put a format list in Rust that Rust
has no use for, and would make the fourth format a Rust change. One
kind plus a path is honest enough, and it is the whole of what keeps
formats out of the core.

`TabState.page` and `TabMove.page` serve a slide number as well as a
page; the type does not change.

### The port, renamed and given one more thing

`pdf/engine.ts` becomes `paged/engine.ts`; `PdfDocument` becomes
`PagedDocument`, `PdfEngine` `PageEngine`, `PdfError` `PagedError` with
the same four reasons. `pdfjs.ts` stays what it is, as
`paged/engines/pdfjs.ts`.

The one addition: a page count that can grow.

```ts
export interface PagedDocument {
  /** How many pages so far. May grow until `laidOut` resolves. */
  readonly pages: number;
  /** Resolves when the count is final; already resolved for a PDF. */
  readonly laidOut: Promise<void>;
  /** Called as the count grows, for the tab's page total. */
  onPages(listener: (pages: number) => void): () => void;
  size(page: number): Promise<PageSize>;
  render(request: RenderRequest): Promise<void>;
  text(page: number): Promise<TextRun[]>;
  outline(): Promise<PagedOutlineEntry[]>;
  destroy(): void;
}
```

`PagedDoc` (today `PdfDoc`) already holds `pages` as state and already
seeds every unmeasured page with page one's size, "which is exactly
what `Heights` was built to absorb" (ADR 0035). A count that grows is a
few more pages seeded the same way. The pdf.js adapter reports its
count once and resolves `laidOut` at open.

### The registry

`paged/formats.ts` is the one list of what a paged tab can be:

```ts
export interface PagedFormat {
  /** Lower-case, without the dot. */
  extensions: readonly string[];
  /** What the status bar counts: "41 pages", "10 slides". */
  unit: 'page' | 'slide';
  /** The Cmd+O filter it is listed under. */
  filter: string;
  /** The engine, loaded the first time a file of this format opens. */
  engine: () => Promise<PageEngine>;
}

export const FORMATS: readonly PagedFormat[] = [
  { extensions: ['pdf'],  unit: 'page',  filter: 'PDF', engine: () => import('./engines/pdfjs.ts').then((m) => new m.PdfJsEngine()) },
  { extensions: ['docx'], unit: 'page',  filter: 'Office documents', engine: () => import('./engines/silurus-docx.ts').then((m) => new m.SilurusDocxEngine()) },
  { extensions: ['pptx'], unit: 'slide', filter: 'Office documents', engine: () => import('./engines/silurus-pptx.ts').then((m) => new m.SilurusPptxEngine()) },
];

export function formatOf(path: string): PagedFormat | null;
```

`isPdfPath` becomes `formatOf(path) !== null`. `WorkspaceOptions.pdfEngine`
becomes `formats: readonly PagedFormat[]`, so tests keep injecting a
fake engine the way they do now, per format. The Cmd+O filter list in
`main.ts` is derived from the registry rather than written by hand.
`lazy.ts` goes away: the registry's `engine` thunks are the laziness.

The status bar's `count(pages, 'page')` takes the format's unit.
`describePdfError` takes the unit's noun too: "is not a readable
document" and "is not a readable deck" rather than "PDF".

### The adapters

`paged/engines/silurus-docx.ts` and `paged/engines/silurus-pptx.ts` are
the only files that may name `@silurus/ooxml`. `single-import.test.ts`
becomes a table of package → allowed files. Each adapter is short:

```ts
// silurus-docx.ts — the shape, not the code
open(url)  → DocxDocument.load(url, { math, progressiveLayout: true, wasmUrl,
                resourceLimits, maxZipEntryBytes, workerTimeoutMs,
                onLayoutProgress: (p) → pages = doc.pageCount; notify() })
pages      → doc.pageCount
size(p)    → pageSize(p - 1) as { width: widthPt, height: heightPt }
render(r)  → if (r.signal?.aborted) return;
             doc.renderPage(r.canvas, r.page - 1, { width: widthPt * r.scale, dpr: 1 })
text(p)    → collectPageRuns(p - 1, { width: widthPt }) → { text, rect: [x, y, w, h] }
outline()  → []
destroy()  → doc.destroy()
errors     → OoxmlError.code: encrypted | invalid-password | unsupported-encryption → 'password';
             not-ooxml | legacy-binary-format → 'corrupt'; anything else → 'unavailable'
```

The pptx adapter is the same with `slideCount`, `slideWidth / 12700`,
`renderSlide`, and `collectSlideRuns` divided by 12700 with the shape's
offset added. `RenderRequest.scale` is the view's `zoom × devicePixelRatio`,
so `width = widthPt × scale` with `dpr: 1` draws the same pixels pdf.js
draws. There is no mid-render cancellation in the library; the adapter
honours `signal` by not starting, and an abandoned render finishes into
a canvas the view has already given back, which is what pdf.js does on
a cancelled task too.

Before `load()`, the adapter awaits the font shims (below), so layout
measures the fonts the page will be painted in.

### Rust

`open_pdf` becomes `open_paged`, `read_pdf_info` `read_paged_info`,
`PDF_BYTES` `PAGED_BYTES`, still 64 MB: a docx or a pptx also arrives
whole and the layout structures sit on top of it. The command does what
it did — refuse a file over the cap, widen the asset scope to the
folder — and knows nothing about formats. specta regenerates the
bindings; the ipc fake follows. No other Rust changes, now or for the
fourth format.

### Bytes, bundling and the policy

- The two parser `.wasm` files are copied to `public/paged/` at Vite
  `config` time by the plugin that copies pdf.js's data today,
  generalised to a list of (package, files) and renamed
  `vendor-assets.ts`, with the same version stamp beside them. The
  library takes `wasmUrl`, so its own `new URL(…, import.meta.url)` is
  never relied on through Vite's dependency pre-bundling — the trap the
  pdf.js worker fell into in ADR 0035. `@silurus/ooxml` joins
  `optimizeDeps.exclude` beside `pdfjs-dist`.
- The worker is built from an inline blob by the library and needs no
  bundling.
- The equation module is passed to `load()` once; its 3 MB chunk is a
  dynamic import the library makes only for a document with an
  equation, so it costs nothing to a deck without one.
- CSP: `worker-src 'self' blob:` is added. Nothing else; verified in
  WebKit by the probe, to be verified in the running app before the
  docx package ships.
- `useGoogleFonts` stays off; `cjkFallback` unset. The bundle's one
  Google Fonts URL is behind the former, and `connect-src` would block
  it anyway.

### Fonts

`@fontsource/carlito` and `@fontsource/caladea` (OFL 1.1, 5.3.0), Latin
subsets only, about 700 KB of woff2 for eight faces, registered under
the names the documents use:

```css
@font-face { font-family: "Calibri"; src: local("Calibri"), url(…/carlito-latin-400-normal.woff2) format("woff2"); font-weight: 400; }
/* 700, italic, bold italic; and "Cambria" → Caladea the same way */
```

`local()` first, so a Mac with Office draws the real font and one
without draws the metric-compatible one, and pagination matches Word
either way. The stylesheet is imported by the adapters, not by the app,
so a markdown session never fetches a face. Aptos has no metric clone
and gets whatever the stack gives it; the research note says why.

### What the shell shares, and what it must not

Exactly ADR 0035's list. Shares: the tab strip, the status bar (with the
format's noun), the window title, session restore, Find, zoom, a move
between windows. Does not share: everything that assumes a buffer, which
`activeDoc` already turns off. The Outline panel shows nothing for a
docx or a pptx in this package; the union it grew for PDF bookmarks is
ready for slide titles later.

### Tests

- `tools/office-fixtures/generate.mjs`, in the shape of
  `tools/pdf-fixtures`: a memo (`docx` on npm, MIT — the spike's
  generator) and a deck (`pptxgenjs`, MIT), committed under
  `paged/fixtures/`. A `.doc` renamed to `.docx` for the `corrupt` case.
- `silurus-docx.browser.test.ts` and `silurus-pptx.browser.test.ts` in
  the shape of `pdfjs.browser.test.ts`: page count, size in points, a
  render that paints something, runs inside the page, `corrupt`,
  `password` (an encrypted fixture), a count that grows past its first
  report on the thesis-sized fixture.
- `tab.browser.test.ts` runs its format-independent cases over every
  registry entry with a fake engine, and gains "says 10 slides".
- `single-import.test.ts` covers both packages.
- The bench opens a 100-slide generated deck and reports first paint
  and memory, because no renderer in the field publishes either.

## The work packages

Each one is a commit that leaves the suite green and the app
shippable; the first two change no behaviour a reader can see.

1. **Rename.** `pdf/` → `paged/`, the port and the classes with it,
   `TabKind::Paged` with the `pdf` alias, `open_paged`. Mechanical, the
   suite is the net. Half a day.
2. **Registry and the growing count.** `formats.ts`, `formatOf`,
   `WorkspaceOptions.formats`, Cmd+O filters from the registry, the
   status bar's noun, `laidOut` and `onPages` on the port with the
   pdf.js adapter reporting once, `PagedDoc` seeding pages as the count
   grows. One format in the registry. A day.
3. **docx.** The adapter, the asset plugin generalised, the CSP line,
   `optimizeDeps`, the fixture generator and the memo fixture, the
   adapter tests, the notices rows. Then the running app: open the
   thesis and the memo in the debug build on this Mac, confirm the
   worker and the wasm load under the real policy, confirm page 1 of
   the thesis within a second. Two days.
4. **pptx.** The second adapter, the EMU translation, the deck fixture,
   its tests. The proof of the seam: this package touches nothing
   outside `paged/engines/`, `paged/fixtures/`, `formats.ts`, the
   fixture tool and the notices. Half a day.
5. **Fonts.** The two packages, the shim stylesheet imported by the
   adapters, the await before `load()`, a test that the memo's line
   count differs with the shim from without, the notices rows. Half a
   day.
6. **Docs.** This ADR's "As built", the README's document list, design
   section 12 amended ("view Word and PowerPoint" leaves the waiting
   list; export stays), the site if the landing page lists formats.

About a week of focused work, the third package the only one with an
unknown in it.

## What this deliberately leaves out

Speaker notes and hidden slides (the library exposes both; a later
package with a design question about where notes go). Comments and
tracked-changes markup (rendered final, as Word's reading view does).
A heading outline for docx and slide titles for pptx (the union is
ready; the data is in the runs). `toMarkdown()` and "Copy for AI" over
an office file — the on-brand one, declined here on purpose so it gets
its own ADR. xlsx, which the same library renders: a workbook is sheets,
not pages, and does not fit the port; declining it is what keeps the
port honest. A password prompt. Dark rendering of pages. "Open with
LibreOffice as PDF" for the file the renderer gets wrong. File
associations: Word and PowerPoint keep the double-click, as Preview
keeps the PDF's.

## Risks, and what answers them

| Risk | Answer |
|---|---|
| The library is five months old, one author, releases weekly | Exact pin; the fixtures in CI; an upgrade is a deliberate review of the fixture screenshots |
| macOS 12's WebKit | Untested, as it was for pdf.js until "As built". Default mode needs a Worker and WebAssembly, which Monterey has; `mode: 'worker'` needs OffscreenCanvas, which it does not, and is never set |
| A file that hangs the parser | `workerTimeoutMs`, surfaced as `unavailable` with the library's message |
| A zip bomb | `resourceLimits` and `maxZipEntryBytes` in the adapter; the 64 MB cap in Rust |
| Memory on a long deck | The bench's 100-slide deck; `getResourceMetrics()` for the number |
| The worker under WebView2 | `worker-src 'self' blob:`; no Windows machine here, so it ships on the strength of the spec |
| A document with a font neither installed nor shimmed | Drift from Word's pagination, as any renderer without the font; said plainly in the docs rather than hidden |

## As built

**WP 1, the rename.** A serde alias on the `Paged` variant, the plan's
way of reading a 0.2.0 session, made specta split `Restore` and the two
commands carrying it into a serialize half and a deserialize half —
exactly the trap ADR 0035 walked around once. So the old word is read
forward in `state.rs`'s `read` instead: a `kind` of `pdf` becomes
`paged` before parsing, and the lenient reader does the same before it
decides what to drop. One test for it, beside the one for unknown kinds.

**WP 2, the registry.** Two knobs on `WorkspaceOptions` rather than the
one the plan drew: `formats` (the list, with the registry as default, so
a test can add a fake deck format) and `pageEngines` (by format id, so a
test still hands in a dozen-line fake the way it handed in one). The
engines' lazy thunks live beside the list rather than in it, because the
list is data the shell and the tests read and the thunks are code only a
Tauri build runs. The port's growth callback went on `open`'s options
(`onPages`) rather than as a subscription on the document, which is one
closure for an adapter to call and nothing to unsubscribe; the document
model turns it into `complete`, a `watchPages` for the view and a
`whenLaidOut` for Find. A place asked for past the pages there are is
kept and gone to when they arrive.

**WP 3, docx.** Three things the bundle taught that the probes had not.
The library sizes the canvas's CSS box as well as its bitmap, from a
width and a device ratio; handed the port's already-multiplied scale
with a ratio of one, it drew every page twice its size in the first
bundle. The adapter now splits the scale back into the two and restores
the box the view set. A file that is not a zip at all fails inside
layout ("page size must be positive") rather than at the container, so
the stage is not something to sort failures by: a password and a limit
are named, a worker that never answered is `unavailable`, and anything
else a failed load can be is `corrupt`. And the status line written when
a file opens is a snapshot, which for a document still being laid out
said "1 page" under a bar reading "Page 1 of 41"; it now says "1 page…"
and is said again, with the final count, when the layout is done.

What the bundle confirmed: the worker and the WebAssembly load under the
policy as written plus `worker-src 'self' blob:`; an agent's
`open_document` over MCP opens a docx by the same road as a PDF; page
one of the 41-page thesis is on screen within a second, with "of 15"
growing to "of 41" over the next four. The `.wasm` files reach the
bundle through `office-assets.ts` and the package's own `exports` map
does not expose its manifest, so the plugin finds the package root from
an entry it does expose.

**WP 4, pptx: the proof of the seam.** The package touched
`engines/silurus-pptx.ts` and its test, one line each in the registry
and the engines map, the single-import table, and two test fixtures
that had assumed only PDF was registered. No Rust, no session shape, no
pane, no Find, no status bar, no Cmd+O: those had learned "paged" and
"slide" in WP 2 and needed nothing more. Two things the deck taught.
The library answers a deck's geometry in EMU whatever width it was
asked at, so the adapter divides by 12,700 for the slide's size and for
each run's place, which is its shape's offset plus its own inside the
shape. And a file that is not a zip at all does not fail: the library
hands back a deck of one blank 16:9 slide, indistinguishable from a real
one. So both adapters now fetch the bytes themselves and refuse anything
whose first four are not a zip's before the library sees it — the same
fetch the library would have made, over the same protocol — and a deck
with no slides is refused as well. The bundle opened an agent's ten-slide
deck and a twenty-slide 2011 one through `open_document`, "Slide 1 of
10" in the bar, each slide at its own width down the pane.

**WP 5, fonts.** Registered through the `FontFace` API from
`office-fonts.ts` rather than from a stylesheet, because the adapters
have to await the faces before the engine lays a page out — layout
measures them — and a promise is the natural shape of that. Eight faces
from fontsource's Latin subsets, `local()` first, once per session and
only when an adapter runs. The bundle set the memo in Carlito where the
first one had set it in Arial, and the thesis came to 40 pages where the
research note's probe had said it would. The test is stable on any
machine: the faces are loaded, and Calibri measures narrower than Arial,
which no substitution of one for the other would give.

**WP 6, docs.** The design's waiting list keeps "export to PDF or DOCX"
and says beside it that viewing all three is in. The research note
points here. Nothing else in the tree describes formats by name, which
is what the registry was for.
