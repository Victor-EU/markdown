import type { UpdateState } from '@markdown/ipc';
import { describe, expect, it } from 'vitest';
import {
  describeUpdate,
  failureReason,
  IDLE,
  reason,
  reportCheck,
  updateAction,
} from './update.ts';

const release = { version: '0.2.0', notes: '' };
const available: UpdateState = { phase: 'available', release };
const ready: UpdateState = { phase: 'ready', release };

describe('what the status bar stands to say', () => {
  it('says nothing at all until there is an update', () => {
    // Up to date, or never asked, or asked with no network behind it: the
    // app's state is the same `idle` for all three, and a reader who did
    // not ask must not be told about any of them (plan WP 1.12).
    expect(describeUpdate(IDLE)).toBe('');
  });

  it('names the version it found, and what to do about it', () => {
    expect(describeUpdate(available)).toBe('Version 0.2.0 is available');
    expect(describeUpdate(ready)).toBe('Version 0.2.0 is ready — restart to finish');
  });

  it('counts a download in whole percent, and waits for a length it may never get', () => {
    expect(describeUpdate({ phase: 'downloading', release, fraction: null })).toBe(
      'Downloading 0.2.0…',
    );
    expect(describeUpdate({ phase: 'downloading', release, fraction: 0.417 })).toBe(
      'Downloading 0.2.0 — 42%',
    );
  });
});

describe('what pressing the cell does', () => {
  it('shows what was found, and restarts what was installed (ADR 0044)', () => {
    expect(updateAction(available)).toBe('show');
    expect(updateAction(ready)).toBe('restart');
  });

  it('offers nothing while there is nothing to offer', () => {
    expect(updateAction(IDLE)).toBeNull();
    expect(updateAction({ phase: 'downloading', release, fraction: 0 })).toBeNull();
  });
});

describe('what a check the reader asked for reports', () => {
  it('answers both ways, which is the whole difference from the daily one', () => {
    expect(reportCheck(IDLE)).toBe('Markdown is up to date');
    // The cell is already saying these; the line beside it does not echo.
    expect(reportCheck(available)).toBe('');
    expect(reportCheck(ready)).toBe('');
  });
});

describe('a failure, as a sentence', () => {
  it('says the two that matter most in words a reader knows', () => {
    expect(failureReason({ kind: 'offline' })).toBe('you seem to be offline');
    expect(failureReason({ kind: 'unverified' })).toBe('the download could not be verified');
  });

  it("keeps the plugin's own words for what it has no kind for", () => {
    expect(failureReason({ kind: 'other', message: 'disk full' })).toBe('disk full');
  });

  it('takes the first line of whatever was thrown', () => {
    expect(reason(new Error('network error\n  at check (…)'))).toBe('network error');
    expect(reason('404 Not Found')).toBe('404 Not Found');
  });

  it('says something rather than nothing when what was thrown is empty', () => {
    expect(reason(new Error(''))).toBe('something went wrong');
    expect(reason('   \n')).toBe('something went wrong');
  });
});
