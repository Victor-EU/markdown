# Office viewing spike

The spike behind `docs/office-viewing.md`: the same Word and PowerPoint
files rendered through the candidate libraries, one page under another
at a fixed width (the sequential view the app already gives a PDF), in
WebKit, with screenshots and timings to look at. Run 2026-09-16.

Not part of the app. Nothing here is imported by anything under
`apps/` or `packages/`, and `spikes/` is outside the pnpm workspace on
purpose: its `package.json` pins the candidates and installs with plain
`npm`.

## How to run

```
npm install
npm run fixtures       # writes fixtures/agent-memo.docx (docx-js)
npm run run            # every (library, file) pair in WebKit → out/
node run.mjs thesis    # only files whose name contains "thesis"
ENGINE=chromium node run.mjs
npm run serve          # then open the URL it prints and change ?lib= and ?f=
```

Playwright resolves from the repository root's `node_modules`, where the
browser suite keeps its WebKit build. Sample files live in `samples/`,
which is not committed: the ones used were two Word documents (2007,
2010), two human-made decks from 2013, and two python-pptx decks written
by models on 13–14 September 2026. `fixtures/agent-memo.docx` is
committed and generated; it is the kind of file an agent hands a human.

`out/` holds `results.json`, `report.md`, and per-page screenshots named
`<lib>-<file>-<ext>-p<n>.png`.

## What was compared

| Format | Library | Output |
|---|---|---|
| docx | `@silurus/ooxml` 0.87.0, headless `DocxDocument` | one canvas per page |
| docx | `docx-preview` 0.4.0 | DOM, emulated pages |
| pptx | `@silurus/ooxml` 0.87.0, headless `PptxPresentation` | one canvas per slide |
| pptx | `@aiden0z/pptx-renderer` 1.3.0, list mode | DOM, one block per slide |

WebKit 26.6 (Playwright's build), 720 CSS px wide, device pixel ratio 2.
No page errors from any library on any file.

## Findings

**silurus, both formats.** It won each pair, and it is the only one of the
four that satisfies the app's paged-document port as it stands.

### docx

- silurus paginates like Word: the 41-page thesis is 41 pages and its
  page 12 says 12, with the header logos, the ruled header text, the
  footnotes and the OMML equations set natively. The agent memo is one
  page with its heading colours, table borders, bullets and numbering.
- docx-preview does not paginate by flow. The thesis became three long
  sections; the second begins with a stranded page number and a repeated
  header, because it breaks only where Word wrote a break. Bullets came
  out as large black discs. The agent memo rendered fine, because a
  one-page memo has nothing to paginate. It is out.
- Layout time is the one cost: 4–9 s for the 41-page thesis before this
  harness draws anything, because it waits for the whole layout. The
  agent memo takes 270 ms. Drawing is about 30 ms a page. The app must
  not wait the way the harness does: silurus has `progressiveLayout`
  and reports pages as they come through `onPageChange`, and the ADR
  spike should show page 1 within a second on the thesis.

### pptx

- On the two agent-made decks both libraries are excellent and close to
  identical: tables, native charts with their target lines, footers,
  theme colours. Nothing to choose.
- On the 2011 Mac deck (zephoria) silurus kept the two-column body; the
  aiden0z renderer ran the left column's text across the right one, a
  layout bug on a human-made file. On the other 2026 deck aiden0z set
  the title in a serif fallback where silurus chose a sans.
- Both drew the thesis deck's EMF equations. Both wrapped "SOMETHING"
  onto two lines on the zephoria title, because the deck's display font
  is not installed and the substitute is wider: font substitution, not a
  renderer fault.
- silurus's `getNotes(i)` returned the speaker notes of the agent deck,
  so notes are there for a later package.
- Timings: silurus lays a deck out in 50–160 ms and draws all slides in
  175–465 ms (about 20 ms a slide); aiden0z opens and renders a whole
  deck in 47–260 ms. Both are fine.

### The font question, answered

The thesis came out sans-serif in the first look, where Quick Look shows
Times. Neither is what Word shows. The document's default run font is
Calibri (`w:docDefaults`, theme minor font Calibri); this Mac has no
Calibri, Cambria, Carlito or Caladea. silurus asks the canvas for
`"Calibri", "Noto Sans", …, "Arial", "Helvetica", …, sans-serif` and gets
Arial; Quick Look's importer falls to Times; docx-preview falls to the
browser's default serif. So this is the missing-Calibri problem from the
note, not a resolution bug. Because silurus names `Calibri` first in its
font string, a Carlito registered under `@font-face { font-family:
"Calibri"; src: local("Calibri"), url(carlito.woff2) }` should be picked
up without any library change. That is the first thing for the ADR spike
to confirm.

## The probes (`probe.mjs`)

Run after the comparison, for the scope in ADR 0042. WebKit 26.6.

- **CSP.** With the app's policy in a `<meta>` tag (verified present),
  the library loaded and rendered a docx and a pptx with no violation
  reported. It makes exactly one worker, from a `blob:` URL; nothing
  failed with or without `worker-src`, and with or without `blob:` in
  `img-src`. Chromium enforces `worker-src` for `blob:`, so the app adds
  `worker-src 'self' blob:` for WebView2 and checks the running app.
- **Units.** docx `collectPageRuns(i, { width: widthPt })` → points
  (rightmost 505 of 595, lowest 779 of 842). pptx `collectSlideRuns` →
  EMU regardless of width; `slideWidth` is EMU too. Divide by 12700.
- **Progressive layout.** Thesis, `progressiveLayout: true`: `load()`
  resolves at 480 ms with 3 pages, page 1 drawn at 700 ms with 7, all 41
  at 3.2 s. Without it: nothing before 3.4 s.
- **Font shim.** Carlito registered as "Calibri" and Caladea as
  "Cambria" through `FontFace` before `load()`: the memo's runs moved
  (lowest 482 → 507 pt), the thesis went from 41 to 40 pages. The shim
  is used for layout, not only paint. `@fontsource/carlito` +
  `@fontsource/caladea` (OFL), Latin subsets, ~700 KB woff2.

### What this does not settle

macOS 12's WebKit (everything ran on 26.6); memory on a long deck; the
worker under WebView2 (no Windows machine); the real app's CSP, as
opposed to a meta tag in a probe page.
