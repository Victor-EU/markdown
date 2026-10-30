import type { Release } from '@markdown/ipc';
import { createFakeIpc, type FakeIpc } from '@markdown/ipc/fake';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeUpdater } from './fake-updater.ts';
import { describeUpdate, failureReason, reportCheck } from './update.ts';
import { Workspace } from './workspace.svelte.ts';

/**
 * The updater as a window sees it (plan WP 1.12, ADR 0044). Nothing here
 * reaches the network or the plugin: the app's updater is a fake that
 * does what `crates/app/src/update.rs` does, and what is under test is
 * what a window says and when, and the order it does things in.
 */

const NEXT: Release = { version: '0.4.0', notes: '## Fixes\n\n- **A thing.** It works now.' };

let host: HTMLDivElement;
let ipc: FakeIpc;
let updater: FakeUpdater;
let workspace: Workspace;
const others: Workspace[] = [];

function open(files: Record<string, string> = {}, withUpdater = true) {
  ipc = createFakeIpc(files);
  updater = new FakeUpdater();
  workspace = openWindow(withUpdater);
}

/** Another window of the same app: the same files, the same updater. */
function openWindow(withUpdater = true): Workspace {
  const made = new Workspace({
    commands: ipc.commands,
    pickFiles: async () => [...ipc.files.keys()],
    updater: withUpdater ? updater : undefined,
  });
  made.watchForUpdates();
  return made;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  open();
});

afterEach(() => {
  workspace.destroy();
  for (const other of others.splice(0)) other.destroy();
  host.remove();
});

describe('checking', () => {
  it('reports both ways when the reader asked', async () => {
    await workspace.checkForUpdates();
    expect(workspace.status).toBe('Markdown is up to date');
    expect(describeUpdate(workspace.update)).toBe('');

    updater.found = NEXT;
    await workspace.checkForUpdates();
    // Said once, by the cell; the line beside it is cleared, not echoed.
    expect(workspace.status).toBe('');
    expect(describeUpdate(workspace.update)).toBe('Version 0.4.0 is available');
  });

  it('shows what the daily check found without saying anything else', async () => {
    // The daily check is the app's; a window only hears how it came out.
    updater.found = NEXT;
    await updater.check();
    expect(workspace.update.phase).toBe('available');
    expect(workspace.status).toBe('');
  });

  it('says plainly why a check did not get an answer', async () => {
    updater.failCheck = { kind: 'offline' };
    await workspace.checkForUpdates();
    expect(workspace.status).toBe('Could not check for updates — you seem to be offline');
  });

  it('keeps an update on offer when a later check fails', async () => {
    // The network going is not a reason to take back what was found.
    updater.found = NEXT;
    await workspace.checkForUpdates();
    updater.failCheck = { kind: 'offline' };
    await workspace.checkForUpdates();
    expect(describeUpdate(workspace.update)).toBe('Version 0.4.0 is available');
  });

  it('says where updates come from when this is not the installed app', async () => {
    updater.failCheck = { kind: 'not_installed' };
    await workspace.checkForUpdates();
    expect(workspace.status).toBe('Updates are only checked in the installed app');

    open({}, false);
    await workspace.checkForUpdates();
    expect(workspace.status).toBe('Updates are only checked in the installed app');
    expect(workspace.update.phase).toBe('idle');
  });

  it('answers a second press while the first is out, without asking twice', async () => {
    const first = workspace.checkForUpdates();
    await workspace.checkForUpdates();
    expect(workspace.status).toBe('Checking for updates…');
    await first;
    expect(updater.checks).toBe(1);
    expect(workspace.status).toBe('Markdown is up to date');
  });
});

describe('installing', () => {
  beforeEach(async () => {
    updater.found = NEXT;
    await workspace.checkForUpdates();
  });

  it('shows the download as it goes and ends ready to restart', async () => {
    updater.progress = [0, 0.5, 1];
    await workspace.installUpdate();
    expect(updater.seen.map(describeUpdate)).toEqual([
      'Version 0.4.0 is available',
      'Downloading 0.4.0…',
      'Downloading 0.4.0 — 0%',
      'Downloading 0.4.0 — 50%',
      'Downloading 0.4.0 — 100%',
      'Version 0.4.0 is ready — restart to finish',
    ]);
    expect(describeUpdate(workspace.update)).toBe('Version 0.4.0 is ready — restart to finish');
  });

  it('says a download that could not be verified, and offers it again', async () => {
    updater.failInstall = { kind: 'unverified' };
    await workspace.installUpdate();
    expect(workspace.status).toBe(
      'Could not install the update — the download could not be verified',
    );
    expect(describeUpdate(workspace.update)).toBe('Version 0.4.0 is available');
  });

  it('installs nothing when nothing was found', async () => {
    open();
    await workspace.installUpdate();
    expect(updater.installs).toBe(0);
  });

  it('asks nothing while an update is ready, and leaves the cell to say so', async () => {
    await workspace.installUpdate();
    const before = updater.seen.length;
    await workspace.checkForUpdates();
    expect(updater.seen.length).toBe(before);
    expect(workspace.status).toBe('');
    expect(describeUpdate(workspace.update)).toBe('Version 0.4.0 is ready — restart to finish');
  });
});

describe('two windows', () => {
  it('are one app: a later window shows the update, and one download serves both', async () => {
    updater.found = NEXT;
    await workspace.checkForUpdates();

    const second = openWindow();
    others.push(second);
    await Promise.resolve();
    expect(describeUpdate(second.update)).toBe('Version 0.4.0 is available');

    await workspace.installUpdate();
    expect(second.update.phase).toBe('ready');
    await second.installUpdate();
    expect(updater.installs).toBe(1);
  });
});

describe('restarting', () => {
  it('writes what is pending before it restarts', async () => {
    // Rust's restart is a quit, which asks every window to write down what
    // it holds. The window that pressed it does not wait to be asked.
    open({ '/a/one.md': '# One\n' });
    let written: string | null = null;
    updater.onRestart = () => {
      written = ipc.files.get('/a/one.md')?.content ?? null;
    };
    await workspace.pickAndOpen();
    workspace.setMode('edit');
    workspace.mount(host);
    const view = workspace.view;
    expect(view).not.toBeNull();
    view?.dispatch({ changes: { from: view.state.doc.length, insert: 'edited\n' } });
    expect(workspace.activeDoc?.dirty).toBe(true);

    updater.found = NEXT;
    await workspace.checkForUpdates();
    await workspace.installUpdate();
    await workspace.restartForUpdate();

    expect(updater.restarts).toBe(1);
    expect(written).toBe('# One\nedited\n');
  });

  it('does not restart before an update is ready', async () => {
    updater.found = NEXT;
    await workspace.checkForUpdates();
    await workspace.restartForUpdate();
    expect(updater.restarts).toBe(0);
  });
});

describe('the words', () => {
  it('has a plain sentence for every way it can fail', () => {
    const kinds = [
      { kind: 'offline' },
      { kind: 'no_release' },
      { kind: 'no_build' },
      { kind: 'unverified' },
      { kind: 'cancelled' },
    ] as const;
    for (const failure of kinds) expect(failureReason(failure)).toMatch(/^[a-z]/);
    expect(failureReason({ kind: 'other', message: 'disk full' })).toBe('disk full');
    expect(failureReason({ kind: 'other', message: '' })).toBe('something went wrong');
  });

  it('says being up to date only when asked', () => {
    expect(describeUpdate({ phase: 'idle' })).toBe('');
    expect(reportCheck({ phase: 'idle' })).toBe('Markdown is up to date');
  });
});
