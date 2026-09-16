# Viewing Word and PowerPoint files

Research and design note. Status: research and spike done 2026-09-16,
library chosen (silurus, both formats), implementation scoped in ADR 0042,
nothing built. The rendered comparison with screenshots is at
<https://claude.ai/artifact/XadmbzAYkiPGGTfAhHXYq8>; this file is the
text of it plus the design it leads to, written down so it survives the
session.

The question is narrow on purpose: read a `.docx` or a `.pptx` in the
app, never write one. Export was deferred by the design (section 12) and
again by ADR 0029; this is the other half, the way ADR 0035 was for PDF.

## The short answer

The port the PDF work built is already the right shape, and one MIT
library fits it for both formats.

`PdfDocument` (`apps/desktop/src/lib/pdf/engine.ts`) asks for a page
count, a page's size in points, a render into a canvas the caller owns,
the text runs with their rectangles, and an outline. Nothing in that is
about PDF; it is a description of a paged document. `@silurus/ooxml`'s
headless `DocxDocument` and `PptxPresentation` expose exactly those,
method for method. So a docx opened here is a PDF with a different
parser behind it, and the design is not a new pane: it is two more
engines behind the existing seam, two more tab kinds, and one
generalised Rust command.

What was declined, and why, in one line each:

- **Quick Look** (Apple's own Office renderer): macOS-only, undocumented
  HTML from a debugging CLI, and it hung for four minutes on a
  python-pptx deck, which is the kind of file an agent writes.
- **LibreOffice headless**: the best open-source fidelity, 590 MB installed.
- **LibreOffice in WebAssembly** (ZetaOffice): 250 MB and a gigabyte of RAM.
- **docx-preview**: does not paginate by flow; a 41-page thesis became
  three sections.
- **mammoth**: an extractor, not a renderer, and its markdown output is
  deprecated upstream.
- **AGPL and closed-core options** (SuperDoc, PPTist, docMentis, the
  closed-source `pptx-preview`): licence, on the posture ADR 0035 took
  with MuPDF.

Two survive as alternatives: `@aiden0z/pptx-renderer` if slides ever
need to be DOM text, and an installed LibreOffice converting to a PDF
for the existing pane as an opt-in for the document the built-in
renderer got wrong.

## What the repository and the job already decide

Five facts narrow the field before any renderer is compared.

**The port exists.** `pdf/engine.ts` has no pdf.js in it. `PdfDoc`,
`PdfView`, `find.ts` and `PdfPane.svelte` consume only that port, and
Find, zoom, the status bar, session restore and moving a tab between
windows all work through it (ADR 0035). A renderer that can satisfy the
port inherits all of it; one that cannot has to rebuild it. This is the
fact the PDF research could not have known, because the PDF work had not
happened yet.

**The files this reader meets are the ones agents make.** The three
decks written by models on this machine this week are python-pptx
output: its template says "Microsoft Macintosh PowerPoint 14" and
reports zero slides in `docProps/app.xml`. Structurally simple, modern
theme fonts, native charts. The other end of the range is a 2013 thesis
with 19 EMF pictures, Symbol-font bullets and OMML equations. Both ends
were tested.

**Licence.** GPL-3.0-only. MIT, Apache-2.0, BSD and OFL flow in. AGPL is
permitted by GPLv3 §13 and declined on posture. Two candidates hide
proprietary WebAssembly behind an MIT wrapper and are out regardless of
quality.

**CSP and the floor.** `'wasm-unsafe-eval'` is already in the policy;
ADR 0035 paid for it, so a WebAssembly parser costs nothing new. The
macOS 12.0 floor is the same open question it was for pdf.js: everything
here ran in Playwright's WebKit 26.6, the build the browser suite uses,
not in Monterey's.

**Four release targets, no native code.** Anything native is sourced,
signed and notarised four times. That ruled out PDFium native and rules
out every macOS-only route: Quick Look, `NSAttributedString`,
AppleScript to Pages or Word. A webview renderer runs identically on all
four and needs no Rust beyond the size cap and the asset-scope widening
`open_pdf` already does.

## The field, as of September 2026

The 2026 field is not the 2024 field. The two libraries every search
still returns first, PPTXjs and PPTX2HTML, are dead (last releases 2022
and 2017) and jQuery-bound. What replaced them is five pptx renderers
and one docx engine, all created between February and May 2026, all
visibly built with agents, all shipping weekly. None has a year behind
it, and every one of them should be pinned.

| Route | Licence | Output | Fits the port | Payload | Verdict |
|---|---|---|---|---|---|
| `@silurus/ooxml` 0.87.0 (docx, pptx, xlsx) | MIT, no deps | canvas + text runs | yes, 1:1 | 8.36 MB raw both, 2.73 gz | **recommended** |
| `@aiden0z/pptx-renderer` 1.3.0 | Apache-2.0 | DOM, ECharts | no | 1.83 MB, 0.45 gz | alternative for slides |
| `pptx-svg` 0.6.5 | MIT, no deps | SVG string | with an adapter | 0.40 MB | fallback for slides |
| `pptx-glimpse` 5.3.0 | MIT | SVG, text as outlines | with an adapter | 0.91 MB | not tried |
| `@office-kit/pptx-preview` 0.9.3 | MIT | SVG | — | 8 MB, mostly fonts | too young; useful SSIM ≈ 0.78 calibration |
| `docx-preview` 0.4.0 | Apache-2.0 | DOM, emulated pages | no | 0.17 MB | not a paginator |
| `mammoth` 1.12.3 | BSD-2 | semantic HTML | no | 0.64 MB | extractor |
| `pptxtojson` 2.1.0 + own renderer | MIT | JSON in points | would need the renderer | 0.43 MB | 80 lines got 80% |
| Quick Look (`Office.qlgenerator`) | Apple | HTML bundle / native view | no | 0 | declined |
| `NSAttributedString` / `textutil` | Apple | attributed string | no | 0 | drops every picture; no pptx |
| LibreOffice headless | MPL-2.0 | PDF | via the PDF pane | 590 MB installed | later opt-in if installed |
| ZetaOffice / LibreOffice WASM | MPL-2.0 | canvas UI | no | ~250 MB | declined |
| SuperDoc 2.15 | AGPL-3.0 | DOM editor | no | 11.6 MB main bundle | declined |
| Docxodus 12.6 | MIT | paginated DOM | no | 23 MB of .NET wasm | declined |
| ChristopherVR/pptx-viewer 3.15 | Apache-2.0 | DOM editor | no | 5 MB core | declined |
| pandoc 3.11 | GPL-2.0+ | markdown | no | 39 MB | the "open as markdown" tool, if ever bundled |
| `rdocx`, `rpptx`, `office2pdf` (Rust) | MIT/Apache | PDF/PNG | via the PDF pane | tens of MB compiled | watch list, 2027 |

### @silurus/ooxml

One Rust parser per format compiled to WebAssembly, a layout engine that
paginates, Canvas 2D painting. The headless classes are the half that
matters here: `pageSize(i)` in points, `renderPage(canvas, i, {width,
dpr})`, `collectPageRuns(i)` returning text with `x y w h`,
`getBookmarkPage`; the pptx twin adds `renderSlide`, `collectSlideRuns`,
`getNotes`, `isHidden`. Both have `toMarkdown()`.

Its feature table (self-reported) covers headers and footers by section,
footnotes at the page foot, columns, TOC fields with leaders, floating
images and text boxes, 186 preset geometries, WMF and EMF, charts, OMML,
bidi and vertical CJK, tracked changes rendered final by default,
embedded fonts. It parses in a Worker by default and renders on the main
thread; `mode: 'worker'` renders in the worker too but needs
OffscreenCanvas (Safari 16.4), so it stays off. No network by default;
the one Google Fonts URL in the bundle sits behind `useGoogleFonts`,
which is off. No `eval`. In the test run every request stayed on
localhost.

The risks are the ones youth brings: 152 releases in five months from
one author, 794 stars, no Safari statement anywhere in its docs (it ran
clean in WebKit 26.6 here), canvas output so no dark mode and selection
through an overlay, exactly as with pdf.js. And one fidelity question
found here and not diagnosed: it set the thesis in a sans-serif where
Word, Quick Look and the file's font table say Times New Roman, which
is installed on this Mac.

### @aiden0z/pptx-renderer

HTML and SVG with inline styles, real text, ECharts for native charts,
an OMML subset to MathML, embedded fonts decompressed, host-supplied
`fontFaces` for the rest, master → layout → placeholder inheritance,
windowed mounting for long decks, and the only visual-regression suite
in the field that its README then declines to oversell. It rendered the
board deck best and fastest (79 ms) and the equation-heavy thesis deck
slowest (6–8 s, because every EMF goes through a PDF fallback). As a
viewer it is a different architecture from the paged port: its own
container, zoom and Find, text as DOM. If slides ever need to be
selectable as DOM text rather than through a run overlay, this is the
library. That is not a need the app has today.

### pptx-svg

Zero dependencies, 0.33 MB of WebAssembly (MoonBit), an SVG string per
slide with real `<text>`, hidden-slide and notes APIs. It drew the board
deck well in 116 ms. It unzips with `DecompressionStream`, which is the
one concrete WebKit gate in the field: Safari 16.4, which macOS 12 has
only if it took the update. Embedded fonts are preserved but not used to
draw. Wrapping an SVG per slide to satisfy the port is real adapter work
for a 19-star project, to save 3 MB over silurus's pptx entry. Fallback.

### docx-preview and mammoth

The established names, retired for this job by the evidence. docx-preview
emulates page boxes but breaks only where Word wrote a break, so the
41-page thesis rendered as three long sections; it has no TOC or field
support (open since 2019), no DrawingML shapes; Symbol bullets came out
as tofu and EMFs as empty frames; the equation survived as MathML. It is
tiny and DOM, which is why a VS Code extension uses it; a reader that
shows a page count cannot. mammoth is honest about being an extractor:
headings, lists, tables, links, nothing else; equations dropped
("unrecognised element oMathPara"), 2.9 MB of HTML because the EMFs are
inlined anyway. Silurus's `toMarkdown()` now covers mammoth's ground
from the same parser that draws the page.

### Quick Look

`qlmanage -p -o dir file` writes a `.qlpreview` bundle: `Preview.html`
with absolutely positioned slides, or for a docx one page-shaped flow
div (not paginated), attachments as PDF and raster, and a plist saying
`AllowJavascript = true`. Loading that HTML in the app's webview would be
executing generator-emitted markup from an untrusted document with
scripts on; Project Zero's 2018 bug in this exact generator is why Quick
Look runs it out of process. The supported API, `QLPreviewView`, is an
NSView that would sit over the webview: no tab strip above it, no theme,
no Find, a second coordinate system kept in step over IPC. Then it hung
on the python-pptx deck (`qlmanage -t`, four minutes at a full core,
killed; `-p` produced nothing for it) while rendering the 2013 decks in
under half a second. The Finder offers this rendering with the space bar
already; the app does not need to offer it worse.

### Convert to PDF and reuse the pane

The architecture is right and every converter is wrong for shipping.
`NSAttributedString` reads docx but drops every picture, header and text
box, cannot read pptx, and paginated the 41-page thesis as 8 pages;
`textutil` is the same importer and has no PDF output. LibreOffice
headless is the best open-source fidelity there is, at 590 MB installed
plus a nested .app to re-sign and notarise; LibreOfficeKit is not a
smaller core. Word, PowerPoint and Pages by AppleScript need the app
installed, an Automation permission prompt, and a visible launch. What
survives is opportunism: if `/Applications/LibreOffice.app` is present,
offer "Open with LibreOffice as PDF" for the document the built-in
renderer got wrong. Zero bytes shipped, a temp PDF, the existing pane.
A later work package.

## Evidence

Six files from this machine: two Word documents (2007 and 2010), two
human-made decks from 2013 (PowerPoint for Mac 2011 and PowerPoint
2007), two python-pptx decks written by models on 13–14 September 2026.
Each went through the renderers in a local static page, first in the
in-app Chromium and then in Playwright's WebKit 26.6 with page errors
captured (none, for any library). Quick Look was driven with `qlmanage`,
Foundation's importer with `textutil` and a 60-line Swift helper.
Timings below are the renderer's own, in WebKit.

| Renderer | 41-page thesis (docx) | 16-slide thesis deck (13 EMF) | 10-slide agent deck |
|---|---|---|---|
| @silurus/ooxml | 41 pages, page 12 says 12; header, footnotes, equations native; **set in a sans, not Times**; 2.7–3.1 s | slide drawn correctly, 80 ms | correct, 75–93 ms |
| @aiden0z/pptx-renderer | — | EMF equations rendered, 6–8 s | best in the set: table, chart with target line, footer; 79 ms |
| pptx-svg | — | good, real text, 434 ms | good, 116 ms |
| docx-preview | "3 pages"; header ok; Symbol bullets tofu; EMFs blank; MathML equation; 102–467 ms | — | — |
| mammoth | clean semantic HTML; equations dropped; EMFs blank; 2.9 MB; 194 ms Node / 987 ms WebKit | — | — |
| pptxtojson + 80-line renderer | — | text and tables placed, images mostly, shapes rough | text, tables, charts-as-pictures fine |
| Quick Look | faithful first page; one flow div, not paginated; 0.47 s | faithful, 0.19 s | **hung, killed after 4 min; no preview** |
| NSAttributedString | text and tables only; 0 pictures; 8 pages | 0 characters | 0 characters |

Sizes, read from the installed packages (the transitive closure of each
entry module's imports and `new URL()` assets):

| What | Raw | Gzipped | Of which wasm |
|---|---|---|---|
| silurus, docx entry | 5.30 MB (28 files) | 1.68 MB | 1.75 MB |
| silurus, docx + pptx | 8.36 MB (38 files) | 2.73 MB | 3.39 MB |
| silurus, + equations (MathJax + STIX, opt-in) | 11.31 MB | 3.79 MB | 3.39 MB |
| aiden0z, standalone browser build | 1.83 MB | 0.45 MB | 0 |
| pptx-svg | 0.40 MB | 0.16 MB | 0.33 MB |
| docx-preview with JSZip | 0.17 MB | 0.05 MB | 0 |
| mammoth | 0.64 MB | 0.14 MB | 0 |
| pdf.js as shipped (ADR 0035, for scale) | 4.66 MiB | — | 1.02 MB |

The honest comparison for silurus is pdf.js: a parser and layout engine
for a format that is not ours, about twice the bytes, half of it
WebAssembly that compiles on first open. The docx and pptx entries share
ten chunks, so the second format costs 3 MB rather than 5. Everything is
loaded on first use, so a markdown session pays for none of it.

## Fonts

Every sample names Calibri; the thesis also names Cambria, Symbol and
Wingdings. Apple ships none of them, and Office 2016+ keeps its fonts
inside its own bundle where other apps cannot see them. This machine has
Arial, Times New Roman and Georgia and no Calibri, Cambria, Aptos or
Segoe. A renderer that lays out text itself measures the substitute, and
line breaks and page counts drift from Word's by the width difference.

The standard answer is metric-compatible OFL faces: Carlito for Calibri,
Caladea for Cambria, Liberation for Arial, Times and Courier (which macOS
has anyway). Carlito is 2.7 MB as four TTFs, roughly half as woff2;
Caladea 330 KB. Registered as `@font-face { font-family: "Calibri"; src:
local("Calibri"), url(carlito.woff2) }`, the real font wins on a Mac
with Office and the clone fills in elsewhere. Aptos, Office's default
since 2023, has no metric clone; LibreOffice settled on Source Sans 3 as
"minimally functional". Decks made this year will reflow a little
whatever is chosen.

Whether silurus honours a FontFace-registered clone during layout is the
first thing to test in the spike; the sans-serif thesis says its font
resolution deserves a look regardless.

## Design

ADR 0035's closing argument was that a PDF tab was cheap only because
the earlier work had paid for it. This is the second dividend of the
same investment. What follows is the shape an ADR would settle.

### The port is a paged document

Rename `PdfDocument` to `PagedDocument` and `PdfEngine` to `PageEngine`
in `pdf/engine.ts`; keep `PdfError` and its four reasons (`password`,
`corrupt`, `too_large`, `unavailable`, all of which silurus can raise).
`WorkspaceOptions` holds engines by extension rather than one:

```ts
// workspace.svelte.ts
- pdfEngine?: PdfEngine;
+ pageEngines?: Partial<Record<'pdf' | 'docx' | 'pptx', PageEngine>>;
```

`PdfDoc`, `PdfView`, `find.ts` and `PdfPane.svelte` do not change,
because they never knew what was behind the port. Whether the directory
is renamed from `pdf/` to `paged/` is a taste question for the ADR; the
single-import test's `ADAPTER` and `PORT` constants move with it.

### One adapter file per format

`office/silurus-docx.ts` and `office/silurus-pptx.ts` are the only files
that may name `@silurus/ooxml`; `single-import.test.ts` already walks the
tree for `pdfjs-dist` and takes a list. The adapter is a translation of
units and indices:

```ts
// silurus-docx.ts — sketch
pages      = doc.pageCount
size(p)    = { width: widthPt, height: heightPt }             // doc.pageSize(p - 1)
render(r)  = doc.renderPage(r.canvas, p - 1, { width: widthPt * r.scale, dpr: 1 })
text(p)    = doc.collectPageRuns(p - 1) → [{ text, rect: [x, y, w, h] }]  // already points
outline()  = []   // headings are not exposed as an outline; getBookmarkPage is; open question
```

A pptx is the same with slides as pages of one size. `getNotes` and
`isHidden` exist and wait for a later package; the first one renders
every slide, hidden or not, the way PowerPoint's own reading view does
not, and says so in the ADR.

`RenderRequest.signal` is honoured by not awaiting a render whose page
has scrolled away; silurus has no cancellation, so an abandoned render
finishes into a detached canvas, which is what pdf.js does on a
cancelled task too.

### Two more tab kinds, one more command

`Docx` and `Pptx` beside `Pdf` in `crates/core/src/state.rs`. The
lenient reader ADR 0035 put in `read` already filters unrecognised kinds
before giving up on a session, so an older build reading a newer session
keeps its other tabs. `TabState.page` serves a slide number as well as a
page; `PdfPlace` is `{ page, fraction, zoom }` and needs no change.

`open_pdf` becomes `open_paged(path)`: the same `PDF_BYTES` cap (64 MB;
a docx or a pptx also arrives whole, and the layout structures sit on
top of it) and the same asset-scope widening, since silurus fetches the
URL itself the way pdf.js does. `openPath` routes by extension the way
it routes `.pdf` today. Cmd+O's filter list gains "Office documents";
the save panels stay untouched, because nothing here is ever written.
`moveTab` already carries path and page for a PDF and does the same for
these.

The status bar's noun changes: "41 pages" for a docx, "10 slides" for a
pptx. `count()` takes the noun. Zoom keeps ADR 0035's rule: Cmd+= over a
paged tab changes the page, not the reading size.

### CSP

silurus decodes pictures through `blob:` URLs (the network log shows the
fetches), so `img-src` gains `blob:`. Workers and WebAssembly are
same-origin and already allowed by `script-src 'self' 'wasm-unsafe-eval'`.
Nothing else: no inline scripts, no remote fonts, no `eval`.

```
- img-src 'self' data: asset: http://asset.localhost;
+ img-src 'self' data: blob: asset: http://asset.localhost;
```

### Loading and assets

A `lazyPageEngine` per format, in the shape of `pdf/lazy.ts`, imported on
first open. The two parser `.wasm` files and the worker chunks are copied
to `public/` at Vite `config` time with a version stamp beside them, the
way `pdfjs-assets.ts` copies cmaps, and for the same reason (`config`
runs before Vite decides how to serve `public/`; `buildStart` is too
late). The equation module (`@silurus/ooxml/math`, MathJax and STIX,
3 MB) is passed to `load()` once and fetched only when a document has an
equation; leaving it out shows a placeholder where the equation was.
Pin the version exactly, as `pdfjs-dist` is pinned.

### Fonts and notices

Carlito and Caladea as woff2 under `public/fonts/office/`, registered
with `local()` first, if the ADR decides to bundle them.
`THIRD-PARTY-NOTICES.md` gains silurus (MIT), MathJax (Apache-2.0), STIX
Two (OFL), Carlito and Caladea (OFL), in the same table shape as the
pdf.js section.

### Tests

A fixture pair, one docx and one pptx, written deterministically by the
same generators the corpus tool uses (python-docx and python-pptx, which
are what agents use too), for the browser suite, which already runs
WebKit. The adapter tests mirror `pdfjs.browser.test.ts`: page count,
page size in points, a render that paints something, runs with
rectangles inside the page, a corrupt file that fails with `corrupt`, a
password file that fails with `password`, a file over the cap refused in
Rust. `single-import.test.ts` gains the two adapter files. The bench
gets a 200-slide deck, because no renderer in the field publishes memory
numbers.

### What this deliberately does not do

Speaker notes, hidden-slide handling, comments, tracked-changes markup,
a docx outline from headings, dark rendering of pages (a canvas is a
canvas; ADR 0035 accepted the same), and `toMarkdown()`. That last one
is worth naming so the ADR can decline it on purpose: `toMarkdown()` on
the same parsed document is the app's own job applied to a Word file. A
colleague's docx arrives, the reader looks at it as pages, and "Copy for
AI" hands the model markdown rather than a screenshot. Design section 9
for a format the design never planned for, at the cost of one method
call. A later package, and an on-brand one.

## The spike, and what it settled

Run 2026-09-16 in `spikes/office-viewing/` (its README has the numbers
and how to run it again). The decision Victor made first: viewing is in
scope, because an AI's deliverable for other humans is increasingly a
Word file or a deck that the human reviews and sends back, and only
takes into Word or PowerPoint at the last step for precise editing. The
view is the sequential, paged one the PDF tab already has; a slide sorter
or an editor is what PowerPoint and Canva are for. Then the spike, both
candidates per format, seven files, WebKit.

**silurus for both formats.** For docx it was the only paginator:
docx-preview turned the 41-page thesis into three sections with a
stranded page number at the top of the second. For pptx the aiden0z
renderer matched it on the two agent-made decks and lost on the
human-made 2011 deck, where it ran one column's text across the other.
Both drew EMF equations, native charts and tables. silurus's speaker
notes API returned the agent deck's notes.

**The sans-serif thesis was font substitution, not a bug.** The
document's default font is Calibri; this Mac has none. silurus asks the
canvas for Calibri first and falls to Arial, Quick Look falls to Times,
docx-preview to the browser's serif. A Carlito registered under the
family name "Calibri" should be picked up without a library change,
because the library's font string names Calibri first; confirming that
is the first task of the build.

**One cost to design around.** silurus takes 4–9 s to lay out the
41-page thesis before the harness draws anything, because the harness
waits for the whole layout; the memo takes 270 ms and a deck under
200 ms. The pane must not wait: the library reports pages as they are
laid out (`progressiveLayout`, `onPageChange`), and page one of the
thesis should be on screen within a second.

**Four probes after that** (the spike's `probe.mjs`): the library loads
under the app's CSP as written, making one worker from a `blob:` URL;
docx runs come back in points when asked at the page's point width,
pptx runs and slide sizes in EMU; progressive layout shows page 1 of
the thesis at 0.7 s instead of 3.4 s, with the page count growing from
3 to 41; and a Carlito registered as "Calibri" is used for layout, not
only paint (the thesis went from 41 to 40 pages). The implementation is
scoped in [ADR 0042](adr/0042-viewing-word-and-powerpoint.md).

**Still open:** macOS 12's WebKit (everything ran on Playwright's 26.6),
memory on a long deck, and the worker under WebView2.

## Open questions

| Question | Why it matters | Weight |
|---|---|---|
| ~~Why did the thesis come out sans-serif?~~ | Answered by the spike: the file asks for Calibri, the Mac has none, and every renderer substitutes differently. See "The spike". | — |
| Does it run on macOS 12's WebKit? | Default mode uses a Worker with WebAssembly, which Monterey has; `mode: 'worker'` needs OffscreenCanvas, which it does not. Test on the real floor, not on Playwright's 26.6. Same question ADR 0035 left open. | High |
| Pin, or track? | 152 releases in five months from one author. A pinned version and a fixture pair in CI turn "it moves fast" from a risk into a chore. | High |
| ~~First page within a second?~~ | Answered: progressive layout draws page 1 of the thesis at 0.7 s. ADR 0042 puts a growing page count on the port. | — |
| ~~Bundle Carlito and Caladea?~~ | Decided in ADR 0042: yes, Latin subsets from fontsource, ~700 KB, registered as "Calibri" and "Cambria" with `local()` first. The probe showed the shim is used for layout. | — |
| ~~One kind or two?~~ | Decided in ADR 0042: one, `paged`, with a `pdf` alias; the format is a registry entry keyed by extension, so Rust never lists formats. | — |
| Outline for a docx | `OutlineEntry` already became a union for PDF bookmarks. silurus exposes bookmarks and a markdown projection, not a heading list per page. | Medium |
| Memory on a 200-slide deck | No renderer publishes numbers. silurus has `resourceLimits` and `getResourceMetrics`; the 64 MB cap bounds the file, not the layout. | Low |
| Password-protected files | silurus takes a `password` load option, so the port's `'password'` failure maps directly; whether the app ever prompts is the decision it did not make for PDF. | Low |

## What was not done

No run on macOS 12. No fidelity diff against Word itself, which is not
installed here. No measurement of memory. The sans-serif thesis was
noticed and not diagnosed. The `pptx-glimpse` and `@office-kit` renderers
were surveyed and not run. Sizes are of the installed packages, not of a
built bundle; tree-shaking may take a little off silurus and will take
nothing off its WebAssembly.

## Sources

- `@silurus/ooxml`: <https://github.com/yukiyokotani/office-open-xml-viewer>, bundle sizes at <https://ooxml.silurus.dev/bundle-size/>
- `@aiden0z/pptx-renderer`: <https://github.com/aiden0z/pptx-renderer>
- `pptx-svg`: <https://github.com/t-ujiie-g/pptx-svg>; `pptx-glimpse`: <https://github.com/hirokisakabe/pptx-glimpse>; `@office-kit/pptx`: <https://github.com/office-kit/pptx>
- `docx-preview`: <https://github.com/VolodymyrBaydalka/docxjs>; `mammoth`: <https://github.com/mwilliamson/mammoth.js/>; `pptxtojson`: <https://github.com/pipipi-pikachu/pptxtojson>; PPTXjs: <https://github.com/meshesha/PPTXjs>
- SuperDoc: <https://github.com/superdoc/docx-editor>, telemetry at <https://docs-v1.superdoc.dev/resources/telemetry>; Docxodus: <https://github.com/JSv4/Docxodus>
- ZetaOffice: <https://github.com/allotropia/zetajs>; measured sizes at <https://github.com/mapo80/libreoffice-web>; <https://github.com/LibreOffice/core/blob/master/static/README.wasm.md>
- LibreOffice headless: <https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html>; installed size: <https://apps.apple.com/us/app/libreoffice/id1630474372?mt=12>
- Quick Look: <https://developer.apple.com/documentation/quicklookui/qlpreviewview>; the 2018 generator bug: <https://www.exploit-db.com/exploits/45032>
- Foundation: <https://developer.apple.com/documentation/foundation/nsattributedstring/documenttype/officeopenxml>
- pandoc pptx reader (3.8.3): <https://pandoc.org/releases.html>; Rust crates: <https://lib.rs/crates/rdocx>
- Fonts: <https://wiki.debian.org/SubstitutingCalibriAndCambriaFonts>; Aptos: <https://blog.documentfoundation.org/blog/2025/11/12/update-about-font-replacement/>; ODTTF: <https://en.wikipedia.org/wiki/ODTTF>
- `DecompressionStream` support: <https://caniuse.com/mdn-api_decompressionstream>
- The sibling PDF note: <https://claude.ai/code/artifact/ab602ac4-b3a9-4fb8-97b8-f460d0a34fad>; this note with screenshots: <https://claude.ai/artifact/XadmbzAYkiPGGTfAhHXYq8>
