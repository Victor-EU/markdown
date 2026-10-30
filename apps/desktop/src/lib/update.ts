import type { Result, UpdateFailure, UpdateState } from '@markdown/ipc';

/**
 * The updater (plan WP 1.12, ADR 0017, ADR 0044).
 *
 * The update is the app's, not a window's: Rust checks, downloads and
 * restarts, and every window is told each time it moves on (ADR 0044).
 * What is here is what a window does with that — the sentences, and
 * which of them can be pressed.
 *
 * The rule that shapes it is still ADR 0017's: an update the reader did
 * not ask about is never allowed to interrupt. The daily check is Rust's
 * and says nothing unless it finds something; only a check the reader
 * asked for reports back either way. Nothing installs itself.
 */

/**
 * What the window needs from the app's updater, so that a test can hand
 * it something else. The real one is the IPC commands, put together in
 * `main.ts`; outside Tauri there is none.
 */
export interface Updater {
  /** Where the update stands, for a window that has just opened. */
  state: () => Promise<UpdateState>;
  /** Ask now. Answers with where the update stands afterwards. */
  check: () => Promise<Result<UpdateState, UpdateFailure>>;
  /** Download what the check found, verify it and put it in place. */
  install: () => Promise<Result<null, UpdateFailure>>;
  /** Quit the way Quit does, and come back as the new version. */
  restart: () => Promise<void>;
  /** Every change from here on, wherever it was asked for. */
  listen: (on: (state: UpdateState) => void) => void;
}

export const IDLE: UpdateState = { phase: 'idle' };

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * The standing sentence: what the status bar keeps showing for as long as
 * an update is in play. Empty when there is nothing to stand there for —
 * being up to date is not news.
 */
export function describeUpdate(state: UpdateState): string {
  switch (state.phase) {
    case 'available':
      return `Version ${state.release.version} is available`;
    case 'downloading':
      return state.fraction === null
        ? `Downloading ${state.release.version}…`
        : `Downloading ${state.release.version} — ${percent(state.fraction)}`;
    case 'ready':
      return `Version ${state.release.version} is ready — restart to finish`;
    default:
      return '';
  }
}

/**
 * What pressing that sentence does, when pressing it does anything. An
 * available update is shown before it is fetched: pressing goes to the
 * About section, where its notes are and where Install is. A ready one
 * has been read already, so pressing it restarts.
 */
export function updateAction(state: UpdateState): 'show' | 'restart' | null {
  if (state.phase === 'available') return 'show';
  if (state.phase === 'ready') return 'restart';
  return null;
}

/**
 * What a check the reader asked for reports in the transient status line.
 * Only that there is nothing new: anything else is already the standing
 * sentence in the cell beside it, and saying it twice in one bar is
 * telling the reader what they are looking at.
 */
export function reportCheck(state: UpdateState): string {
  return state.phase === 'idle' ? 'Markdown is up to date' : '';
}

/**
 * Why it did not work, in words a reader can act on — or at least not be
 * puzzled by. The kind comes from Rust, which still had the plugin's
 * error as a type; the words are here, beside every other sentence the
 * window says.
 */
export function failureReason(failure: UpdateFailure): string {
  switch (failure.kind) {
    case 'not_installed':
      return 'this build is not an installed app';
    case 'offline':
      return 'you seem to be offline';
    case 'no_release':
      return 'the update server did not answer properly';
    case 'no_build':
      return 'the release has no build for this computer';
    case 'unverified':
      return 'the download could not be verified';
    case 'cancelled':
      return 'the password prompt was cancelled';
    case 'other':
      return failure.message === '' ? 'something went wrong' : failure.message;
  }
}

/** A thrown anything, as a phrase short enough for the status line. */
export function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const first = text.split('\n')[0]?.trim() ?? '';
  return first === '' ? 'something went wrong' : first;
}
