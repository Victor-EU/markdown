# ADR 0040: A tab is dragged with the pointer, not the browser's drag and drop

Status: accepted, 2026-09-13. Replaces the HTML5 drag on the tab strip
of ADR 0023 and ADR 0026 with pointer events. Nothing in Rust changes.

Design 4.1 asks for two gestures on a tab: drag it along the strip to
reorder, drag it out of the window to tear it into a window of its own.
Both were built on the browser's drag and drop — `draggable`, a `drop`
on the tab it landed on, a `dragend` that meant a tear-off when no drop
had come first. The reorder half had a browser test and passed it, and
ADR 0026 recorded that it "could not be driven by hand" because a
synthesized drag reached `dragstart` and `dragend` but never `drop`.

That reading was wrong. Traced in the running app on 2026-09-13, a
drag that macOS tracked all the way across the strip — Tauri's own
`onDragDropEvent` reported the enter, a hundred overs, and a drop on the
target tab — reached the page as `dragstart` and `dragend` only. With
`dragDropEnabled`, which is the default and what the open-by-drop of WP
1.8 relies on, wry overrides `draggingEntered`, `draggingUpdated` and
`performDragOperation` on the webview and forwards to WebKit only when
its listener says no; tauri-runtime-wry's listener always says yes. So
no `dragenter`, `dragover` or `drop` can ever reach the DOM in this
app on macOS, from a mouse any more than from a script. Every drag on
the strip tore the tab off, and v0.1.0 shipped that way.

## Pointer events, because a held button is not a drag session

A press that moves is plain mouse tracking: `pointerdown` on the tab,
`pointermove` and `pointerup` on the window. AppKit keeps delivering a
held button's moves to the window it was pressed in, from outside the
tab, the strip, and the window itself, so nothing about the tear-off
changes: the page still says only that the tab was let go of off the
strip, and Rust still reads the pointer and decides between the window
under it and a new one (ADR 0023). What the page gains is the drop it
never had, and with it the things the browser's drag never gave it —
the tab in hand follows the pointer, its neighbours slide out of its
way and back, and it slides the last of the way into its slot when let
go of. Escape puts everything back, as it did.

A press is a click until it has moved four pixels, so a tab is still
activated by clicking and pinned by double-clicking, and the close
button is still a button. Picking a tab up brings it to the front, which
the click it would otherwise have been would have done. A pinned tab
moves within the pinned block and the rest within theirs, which is the
rule `workspace.move` already kept; the strip keeps it visually too, so
the tab in hand stops at the block's edge rather than crossing a line it
cannot land over. The pointer is off the strip once it is more than
twenty-four pixels above or below the title bar or outside the window's
width; the tab lifts to say so, and letting go there is the tear-off.

The alternative was turning `dragDropEnabled` off, which lets WebKit
run its own drag session and would have made the HTML5 code work as
written. It also takes the file paths out of a Finder drop: WebKit
exposes dropped files to the page without their paths, and the page
needs the path to open a document (WP 1.8). Pointer events cost the
strip nothing it wanted from the drag session and leave the file drop
where it is.

## What is not done

- **The strip does not scroll itself while a tab is dragged.** With
  more tabs than fit, a tab can be dragged only to the edge of what is
  in view. Chrome scrolls the strip under a tab held at its edge.
- **A tear-off has no live window under the pointer.** The window
  appears where the tab is let go of, as before (ADR 0023). Chrome
  detaches on the spot and moves the new window with the drag.
- **Tab positions are measured once, at pickup.** A strip that changes
  width or scrolls during a drag is drawn against stale positions until
  the tab is let go of.
- The browser tests drive the gesture with dispatched `PointerEvent`s.
  The real gesture was proved in the running app with a system-level
  press, move and release on 2026-09-13, both the reorder and the
  tear-off; see the memory note of that day for how.
