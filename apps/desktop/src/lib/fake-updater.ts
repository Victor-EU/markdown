import type { Release, Result, UpdateFailure, UpdateState } from '@markdown/ipc';
import { IDLE, type Updater } from './update.ts';

/**
 * The app's updater as the tests see it: what `crates/app/src/update.rs`
 * does, without the plugin or the network (ADR 0044). One state, told to
 * every window that listens, so two workspaces handed the same one are
 * two windows of one app.
 */
export class FakeUpdater implements Updater {
  /** What the next check finds. */
  found: Release | null = null;
  failCheck: UpdateFailure | null = null;
  failInstall: UpdateFailure | null = null;
  /** Fractions the download passes through before it is done. */
  progress: (number | null)[] = [];
  checks = 0;
  installs = 0;
  restarts = 0;
  /** Every state, in order, as the windows were told it. */
  seen: UpdateState[] = [];
  /** Runs at the restart, for what a test wants to know at that moment. */
  onRestart: (() => void) | null = null;
  private current: UpdateState = IDLE;
  private readonly listeners: ((state: UpdateState) => void)[] = [];

  /** Say the app was already here before anybody asked. */
  stand(state: UpdateState): void {
    this.current = state;
  }

  private set(state: UpdateState): void {
    this.current = state;
    this.seen.push(state);
    for (const listener of this.listeners) listener(state);
  }

  async state(): Promise<UpdateState> {
    return this.current;
  }

  listen(on: (state: UpdateState) => void): void {
    this.listeners.push(on);
  }

  async check(): Promise<Result<UpdateState, UpdateFailure>> {
    this.checks += 1;
    if (this.current.phase === 'downloading' || this.current.phase === 'ready')
      return { status: 'ok', data: this.current };
    if (this.failCheck !== null) return { status: 'error', error: this.failCheck };
    this.set(this.found ? { phase: 'available', release: this.found } : IDLE);
    return { status: 'ok', data: this.current };
  }

  async install(): Promise<Result<null, UpdateFailure>> {
    if (this.current.phase !== 'available') return { status: 'ok', data: null };
    this.installs += 1;
    const release = this.current.release;
    this.set({ phase: 'downloading', release, fraction: null });
    for (const fraction of this.progress) this.set({ phase: 'downloading', release, fraction });
    if (this.failInstall !== null) {
      this.set({ phase: 'available', release });
      return { status: 'error', error: this.failInstall };
    }
    this.set({ phase: 'ready', release });
    return { status: 'ok', data: null };
  }

  async restart(): Promise<void> {
    if (this.current.phase !== 'ready') return;
    this.restarts += 1;
    this.onRestart?.();
  }
}
