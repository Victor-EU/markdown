# ADR 0044: The update is the app's

Status: accepted, 2026-10-29. Covers finding, fetching and installing a
new release from inside the app: who does it, when it looks, what the
reader is shown, and how a release's notes reach a copy that is about to
update. Builds on ADR 0017, whose updater this keeps the shape of and
moves out of the window.

ADR 0017 shipped an updater in WP 1.12, and it works: every release
since 0.3.0 publishes a signed `latest.json`, and an installed 0.3.0
offers 0.3.2 in its status bar. What it left:

- **One per window.** The check, the plugin's `Update` handle, the
  download and the relaunch all lived in the webview, and every window
  has its own. Two windows made two checks on two timers. A download
  started in one left the other still offering the update, and pressing
  it there downloaded it again.
- **A relaunch that wrote down one window.** `restartForUpdate` flushed
  its own window and called the process plugin's `relaunch`. That raises
  `ExitRequested` with Tauri's restart code, and Tauri ignores
  `prevent_exit` for that code, so `before_exit` could not hold the quit
  while the other windows wrote what they held. An autosave on its timer
  in another window went with the process.
- **Errors in the plugin's words.** Offline read *error sending request
  for url (https://github.com/…)*.
- **No notes.** The manifest's `notes` was always empty, because the
  notes are written on the draft after the build has uploaded it, and
  the app had nowhere to show them anyway.
- **Every launch looked.** Ten seconds after each launch, then every six
  hours, with nothing remembered between launches.
- **Check for Updates…** was in Help, and a Mac app keeps it in the
  application menu.

## Rust keeps the update

`crates/app/src/update.rs` holds the one `UpdateState` — `idle`,
`available`, `downloading` (with a fraction), `ready` — and the plugin's
`Update` between the check and the download. Every change is sent to
every window as `UpdateEvent`, the way the agent server's state is. A
window asks `update_state` when it opens, listens, and calls
`check_for_update`, `install_update` and `restart_to_update`. The
workspace's `Updater` is those four commands and the event, put together
in `main.ts`.

`checking`, `none` and `failed` are gone from the shared state. They were
what one window had to say, not where the app stands. A check under way
is the asking window's status line, up to date is `idle`, and a failure
is the command's result, said in the window that asked. A check that
fails leaves the state alone. Under 0017, an automatic check that failed
replaced `available` with `failed`, and the cell vanished because the
network had dropped.

Two windows pressing Install at once start one download: the step from
`available` to `downloading` is one look under one lock.

`tauri-plugin-process` and both JavaScript plugin packages are gone. The
capability no longer grants `updater:default` or `process:allow-restart`,
so a page can reach the updater only through the app's commands.

## Once a day

Ten seconds after launch, and then every hour, the app reads when the
endpoint last *answered* a check, from `update-check.json` in the app
data directory. A day or more ago, it asks. Reading a time costs
nothing, so an app left open overnight asks in the morning, not at
whatever hour it started. A check that got no answer is not written
down, so the next hour tries again. A last check in the future means the
clock was moved, and it is due. A `tauri dev` build (`tauri::is_dev()`)
never checks, and says so when asked.

The automatic check is silent either way, as in 0017. Only a check the
reader asked for reports, and it reports only *Markdown is up to date*.
Anything else is already the cell's standing sentence, and the end-to-end
run below showed the two side by side in one bar.

## Restart is Quit, then launch

`restart_to_update` sets a flag and calls `AppHandle::exit(0)`, which is
exactly what the menu's Quit does:

- every window gets `BeforeCloseEvent` and writes what it holds;
- the last window closing lets the exit through;
- `RunEvent::Exit` writes the session and closes the agent endpoint.

Then `update::finish` calls `AppHandle::restart()`. On the main thread
that cleans up and spawns the bundle's executable, named from its
`Info.plist`, with the same arguments and environment. The new version
opens the session the old one has just written. The window that pressed
Restart also flushes before asking, which costs nothing.

## Ready means in place, except on Windows

On macOS and Linux the download is installed the moment it has been
verified, off the async runtime, because it unpacks an archive and may
wait on a password prompt. `ready` therefore means the new version is on
disk. A reader who quits instead of restarting still gets it on the next
launch, and "restart to finish" is literally true.

On Windows the plugin's installer ends the process the instant it
starts (`std::process::exit` inside `install`). So the verified bytes
are held and the installer runs from `finish`, after every window has
written. That path has not run: there is no Windows machine.

## Failures are kinds, said in words

Rust has the plugin's error as a type, so it sorts it. The window has
every other sentence the app says, so it writes the words:

| `UpdateFailure` | from | said |
|---|---|---|
| `offline` | any `reqwest` error that is not a status | you seem to be offline |
| `no_release` | an error status, no manifest, a manifest that does not parse, a download that is not there | the update server did not answer properly |
| `no_build` | the manifest has no entry for this OS and architecture | the release has no build for this computer |
| `unverified` | minisign, base64 or UTF-8 trouble with the signature | the download could not be verified |
| `cancelled` | the admin prompt for a protected bundle was dismissed | the password prompt was cancelled |
| `not_installed` | a `tauri dev` build | Updates are only checked in the installed app |
| `other` | anything else | the plugin's first line |

Each sentence comes after *Could not check for updates —* or *Could not
install the update —*.

## Where it shows

- **The status bar**, as in 0017: one cell, only while there is an
  update. While one is available, pressing the cell opens Settings
  scrolled to About, where its notes are. While it downloads, the cell
  shows *Downloading 0.3.3 — 42%* and cannot be pressed. When it is
  ready, pressing the cell restarts.
- **Settings, About.** Beside the version is one button that does
  whatever comes next: *Check for updates*, *Install update*,
  *Restart*. Beside the button is the standing sentence. Under it are
  the release's notes, rendered by Read mode's parser and renderer, set
  smaller, with a rule down the left; their links leave for the browser.
  The row keeps a button's height while the download stands in for the
  button, so the notes do not jump.
- **The application menu**, on macOS: *Check for Updates…* under About.
  Install Update and Restart to Update stay in Help, because every
  command the palette lists is in the bar (`menu.test.ts`).

There is no dialog (build plan rule 5), no badge, no "remind me later",
and nothing after the relaunch saying it happened. The reader pressed
Restart.

## The notes are the release's

The notes are the release body up to its first `## Downloads` heading
(`notesFrom` in `tools/release/manifest.mjs`). Everything from there on
is for someone getting the app, not for a copy updating itself: the
installer table, the signing, which old copies are offered this, the
changelog link. `release-notes.yml` runs when a release is published,
and again when a published release's notes are edited. It downloads the
release's `latest.json`, sets `notes`, and uploads it over the old one.
The signatures are over the artifacts, not the manifest, so they are
untouched.

For the half minute between publishing and that job finishing, the
manifest has no notes, and a copy that checks then shows none.
`pnpm release:notes` puts them in before publishing, for a release that
cares (docs/release.md).

## Proved on this Mac, 2026-10-29

Two debug bundles of this branch, each stamped 0.3.1 with
`--config version`, each run with a fresh `HOME`, were driven with real
clicks and keys, by process ID.

**A: the published endpoint and the compiled-in key.**

1. Ten seconds after launch, the daily check found the published 0.3.2
   on GitHub and wrote `update-check.json`. The cell said *Version 0.3.2
   is available*.
2. Pressing the cell opened About, with *Install update*.
3. The download read *Downloading 0.3.2…*, then *22%*, then *100%*.
4. It ended *ready — restart to finish*. The bundle on disk was now
   0.3.2, and `spctl` said *accepted, Notarized Developer ID*, while the
   0.3.1 process ran on.
5. A second window opened after that showed *ready* too.

The relaunch was proved in run B instead: a mistake in the test driver
(a Command modifier left set) turned a typed "o" into ⌘O. The open panel
cannot start under a fake `HOME`, and the dialog plugin panicked.

**B: a local manifest.** It was served on 127.0.0.1 and was the
published one with the notes put in by `notes.mjs`, so the artifact,
the signature and the key were all real.

1. With the server down, the launch check said nothing and recorded
   nothing.
2. *Check for Updates…*, chosen from the application menu, said
   *Could not check for updates — you seem to be offline*.
3. With the server serving the Linux signature for the macOS archive, the
   check found 0.3.2. The cell opened About with the 0.3.2 notes rendered
   under *Install update*.
4. Install said *Could not install the update — the download could not
   be verified…*. The bundle stayed 0.3.1, and the update was offered
   again.
5. With the right signature, the install went through.
6. Unsaved text was typed into a new file in each of two windows, and
   Restart was pressed in the second. The old process exited, and a new
   one started about a second later.
7. The new process restored both windows with their text, and About
   said *Markdown 0.3.2*.

The run found three small things, fixed before this was written:

- the manual check's status line echoed the cell;
- the *unverified* sentence was too long for the bar;
- the About row jumped when the button gave way to the progress text.

## Tests

- `update.rs`:
  - a check is due once a day, and when the clock has gone back;
  - the record survives a restart, and an unreadable one makes a check
    due;
  - each plugin error that can be built without a network or a key maps
    to its kind.
- `update.test.ts`: the sentences, what the cell does, and the words for
  each failure.
- `update.browser.test.ts`, against a `FakeUpdater` that does what
  `update.rs` does:
  - a manual check reports up to date, and is otherwise left to the cell;
  - the daily check's find shows without a word;
  - a failed check keeps the update on offer;
  - two presses make one check;
  - the download's progress shows, and it ends ready;
  - an unverified download is offered again;
  - two windows share one state and one download;
  - the restart writes what is pending first.
- `shell.browser.test.ts`:
  - the cell opens About with the notes rendered and installs nothing;
  - Install, then Restart;
  - a link in the notes goes to the browser;
  - the download cell cannot be pressed.
- `menu.test.ts`: the check sits under About and appears only once in
  the bar.
- `manifest.test.mjs`: `notesFrom` on the shape of the 0.3.2 notes, CRLF
  included.

## Not done

- **The Windows path has not run**: the install held for the restart, and
  whether the passive MSI starts the app again afterwards.
- **`release-notes.yml` has not run.** The first published release will
  run it. Its log ends with the rewritten manifest.
- **Copies already installed (0.3.0–0.3.2) run 0017's updater.** They
  update to the next release through it as before. The manifest's shape
  has not changed, and they ignore the notes.
