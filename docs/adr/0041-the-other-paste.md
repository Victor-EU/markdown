# ADR 0041: The other paste, and the editor's own right-click menu

Status: accepted, 2026-09-13. Adds a second paste beside the smart one
of design 4.5, and replaces the webview's context menu in the editor
with one of the app's. Cmd+V does not change.

The paste of design 4.5 takes the richest thing the clipboard holds:
an image over a link, a link over rich text, rich text over plain. So a
heading copied out of a web page, where the heading is itself a link,
lands as `## [Quarterly **results**](https://example.com/post)`. For a
table or a list that is the whole point of the converter. For a title,
which is what most copies out of a browser are, it is a link nobody
asked for, and the reader's next move is to take it apart by hand.

Checked in the running app on 2026-09-13 before this was built: the
webview's own right-click menu offered Cut, Copy, Paste, then Spelling
and Grammar, Substitutions, Transformations, Font, Speech, Paragraph
Direction, Selection Direction, Inspect Element and AutoFill. Its Paste
went through the app's paste handler and made the linked heading. The
system's own plain paste, Cmd+Option+Shift+V, did nothing in the
editor. There was no plain paste anywhere in the app.

## Not a setting

Most readers want the table kept, so the default stays. The choice
between a setting that flips the default and a second paste beside the
first is the one Word made long ago: both, with the second paste the
one people know. A setting was left out on purpose. It would be one
more thing to find, and the reader who wants plain text wants it for
this paste, not for every paste after it.

## Paste and Match Style

The second paste is a command of the app's, `edit.pastePlain`, called
what macOS calls it and on the key macOS puts it on, Cmd+Shift+V. It
is in the Edit menu directly under Paste, in the palette, and in the
editor's right-click menu. It reads only the clipboard's plain
flavour and inserts it as it is: no HTML is converted and no image is
written. The one rule it keeps from the smart paste is that a URL
landing on a selection makes a link, because that gesture means the
same thing however the paste is asked for. A clipboard with no text
on it, an image say, changes nothing and says so in the status line.

The clipboard is read through Rust, by a `clipboard_text` command over
the clipboard-manager plugin, rather than by the page. A page may read
the clipboard only inside a user gesture, and an item chosen from a
native menu reaches the page as an event, outside any. In a browser
build the page's own reader is tried and a refusal is a clipboard with
nothing on it.

Only where there is an editor: the command is greyed out in Read
mode, which has no caret to paste at. The marks are not, because they
work through the document's own state (ADR 0016).

## The editor's own menu

Tauri cannot add one line to WebKit's menu; it can only replace it. So
a right-click on the editor's content, in Edit and Source mode, puts
up a native menu the window describes in the same terms as the menu
bar (ADR 0032): Cut, Copy, Paste and Paste and Match Style, then Bold,
Italic, Link and Code. The standard items are the same AppKit
selectors the bar's are, sent down the responder chain, so Cut, Copy
and Paste reach the webview as before and grey themselves out by
WebKit's own rule; the app's items carry their command ids and come
back by the event the bar's do. `show_context_menu` is the one new
Rust command, async so the wait for the menu to close is not spent
inside the webview's message handler.

What is lost is the spelling suggestions on a misspelled word, which
live inside WebKit's menu behind no API the webview exposes. The red
underline and the checker stay; the correction list on right-click
goes. Font, AutoFill, Speech and Inspect Element go with it, which for
a markdown file is no loss. Read mode and the sidebar keep the
webview's menu, which in a page that is not editable is Copy, Look Up
and the like, all of which are wanted.

The menu is a native one only where the bar is, Tauri on macOS. In a
browser build and on the other platforms a right-click is left alone,
and Paste and Match Style is still on its key and in the palette.

## What is not done

- **A right-click inside a table cell shows the webview's menu.** The
  cell editor is an editor view of its own (WP 0.4) and does not carry
  the document view's handlers.
- **Paste and Match Style does not write an image.** A clipboard that
  holds only an image says "The clipboard holds no text"; Cmd+V is the
  paste that writes it beside the document.
- **Cut and Copy do not grey out with nothing selected.** muda turns
  AppKit's own item validation off on every menu it builds and gives a
  standard item no switch of its own, so the popup's Cut and Copy are
  black however empty the selection, as the menu bar's already were.
  Chosen then, they do nothing.
- **No Paste as Markdown.** A default that keeps formatting has no need
  of a third paste that keeps it harder.
- The browser tests dispatch a `contextmenu` event and fake the
  clipboard read; the menu itself, the key and the Rust read were
  proved in the running app on 2026-09-13.
