# ADR 0043: A selection is drawn on the text

Status: accepted, 2026-10-29. Covers how Edit and Source mode draw a
selection: its shape, where it sits among what the page paints, and its
colour.

A selection from a heading to the end of the code block under it came
back as a lavender block wider than the column on both sides, filled out
to the right on the heading's line, and gone inside the code block,
which looked unselected. The verdict: a good selection is on the text,
and a selected paragraph is highlighted as the paragraph. The screenshot
was from 0.3.0, and three things made it:

- **Under the page.** `drawSelection()` paints the selection in a layer
  behind the text, and a fence's lines paint an opaque ground
  (`--code-bg`) over it. Inline code, `==highlights==` and the block
  widgets hide it the same way.
- **To the column, not to the text.** For a selection over more than one
  line, CodeMirror fills the first line from the selection's start to the
  content box's right edge, the lines between from edge to edge, and the
  last from the left edge. A heading, the end of a paragraph, a blank
  line or a line of code is highlighted far past its last word. It is
  TextEdit's convention and CodeMirror's default.
- **Past the column.** The gutter was padding on the content box, so
  those edges were 16px and 24px outside the text. 8fd04b5 fixed this
  one in 0.3.1.

## Each row is as wide as what is selected on it

`textSelection()` in `editor-core/src/selection.ts` is a layer of the
app's own. For every line a range covers, it takes the client rects of
the selected text (and of an inline widget, whole or not at all), groups
them into visual rows, and draws each row from its first selected
character to its last. Nothing is drawn to the column's edge, and only
what is on the screen is measured.

A row is the line's height: half the leading is added above the letters
and half below, so the rows of a paragraph meet. A selected line break
adds a nub half a character wide at the end of its line, and a blank
line is only that nub.

A list item's row starts at its words. Its bullet, box or number, and
the space after a number, stay outside the highlight, as they do in
Google Docs; the copied text has them either way. A marker is drawn as
selected only when nothing else on its line is, so a selection is never
invisible. That is a rule and not a side effect: with the selection
starting at a line's beginning the bullet widget is inside the range,
and the first prototype drew it on some lines and not others.

## A paragraph is one shape

Rows that meet and overlap are joined into one outline, drawn as one SVG
path with a 4px radius on every corner, inner corners included. A
selected paragraph is drawn as its own silhouette, ragged right and all.
A blank line's nub sits at the text's left edge, so it joins the
paragraphs on either side along that edge rather than flooding the gap
between them. Rows that do not overlap, such as the end of one line and
the start of the next, are separate shapes.

## Above the text, blended into it

The layer is drawn over the text and multiplied into it on a light
paper, screened on a dark one. The letters keep their colour, and the
selection shows the same on the paper, a code block, an inline chip, a
highlight or a callout. It is the technique the PDF view's Find marks
already use (`.paged-text` in `app.css`).

WebKit blends an element with what is under it only inside the
element's own box. CodeMirror's layers have no size, and the first
prototype's shapes overflowed one-pixel boxes, so they were painted flat
over the text they were meant to tint. The layer is as tall as the
document (`view.contentHeight`), and every outline is an `svg` the size
of what it draws.

## The colour

The paper's accent, `--mdr-link`, at 27% on a light paper and 34% on a
dark one; unfocused, the paper's ink at 11% and 13%. CodeMirror's stock
lavender (`#d7d4f0`, `#223333` dark) is gone. No theme set it, so it
ignored the accent the PDF view's selection already wore.

The strength is `fill-opacity`, not `color-mix()`. Under multiply or
screen the two come to the same pixels, and a WebKit without
`color-mix()` (Safari before 16.2, which a Monterey that was never
updated still has) would have filled the outlines black over the text.
`--mdr-selection` and `--mdr-selection-idle` name a colour to use
instead of the accent and the ink, for a theme that wants its own; none
sets them yet.

## CodeMirror's layer stays loaded

`drawSelection()` still draws the caret and hides the native selection.
CodeMirror does not export its cursor and selection layers separately,
so the selection layer is hidden by a theme scoped to editors that have
this one. A table cell's editor has neither and keeps the webview's own
selection.

## Block widgets

None is ever inside a selection. The reveal rule gives a block's source
back as soon as a selection touches it (design 7.1), so a selected table,
image or diagram is selected as text. The review panels are widgets but
not the document, and are not drawn as selected.

## What was weighed

- **Keep the fill, draw it above the text.** The smallest change, a blend
  mode on CodeMirror's own layer, and it ends "under the page". It leaves
  the fill out to the column, which is most of what was reported.
- **Fill each paragraph's box.** Stops at the paragraph's longest line
  rather than the column, but still paints the space after its last
  line, and hides where the selection ends.

## What is not done

- **Read mode** uses WebKit's own selection. Whether it should match,
  and how far apart the two are, has not been checked.
- **Right-to-left text** is grouped by row like any other, so a row that
  mixes directions is drawn from its leftmost selected character to its
  rightmost.
- **Several selections at once** are drawn range by range. Only one
  range at a time is tested.
- **No bench.** Each selection change measures the selected text on the
  screen; a drag over a long document has not been timed.

The browser tests run in Chromium and Playwright's WebKit. The real
gesture was proved on 2026-10-29 in a debug bundle with a clean profile:
a system-level drag from a heading through a code block, and from a list
into a quote, on a light paper and a dark one. The letters under the
selection kept their colour, and the bullets stayed outside it.
