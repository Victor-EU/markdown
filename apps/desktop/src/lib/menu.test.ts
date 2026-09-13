import { describe, expect, it } from 'vitest';
import { appCommands } from './app-commands.ts';
import { CommandRegistry } from './commands.ts';
import { editorMenu, menuBar } from './menu.svelte.ts';

/**
 * As much of a workspace as the commands read to say whether they can
 * run and what they are called. Everything absent is a command that is
 * off, which is what a window with nothing open looks like.
 */
function workspace(over: Record<string, unknown> = {}) {
  return {
    activeTab: null,
    activeDoc: null,
    activePinned: false,
    canSave: false,
    canReopen: false,
    overridden: false,
    folder: { root: null },
    update: { phase: 'idle' },
    agent: { port: 0 },
    find: { query: '' },
    ...over,
  } as never;
}

function bar(over: Record<string, unknown> = {}) {
  const registry = new CommandRegistry(true);
  registry.register(...appCommands(workspace(over)));
  return menuBar(registry);
}

/** The menu of that name, which every assertion here starts from. */
function menu(sections: ReturnType<typeof bar>, title: string) {
  const found = sections.find((section) => section.title === title);
  if (!found) throw new Error(`no ${title} menu`);
  return found.items;
}

/** One of the app's own commands in that list, or null if it is not there. */
function command(items: ReturnType<typeof menu>, id: string) {
  for (const item of items) if (item.kind === 'command' && item.id === id) return item;
  return null;
}

const ids = (items: ReturnType<typeof menu>) =>
  items.flatMap((item) => (item.kind === 'command' ? [item.id] : []));

const roles = (items: ReturnType<typeof menu>) =>
  items.flatMap((item) => (item.kind === 'standard' ? [item.role] : []));

/** Every line as one word: a role, a command id, or `separator`. */
const lines = (items: ReturnType<typeof menu>) =>
  items.map((item) =>
    item.kind === 'standard' ? item.role : item.kind === 'command' ? item.id : 'separator',
  );

describe('the menu bar', () => {
  it('is the registry, in the order macOS puts it', () => {
    expect(bar().map((section) => section.title)).toEqual([
      'Markdown',
      'File',
      'Edit',
      'View',
      'Go',
      'Window',
      'Help',
    ]);
  });

  it('carries each command by the id, name and key it was registered with', () => {
    expect(command(menu(bar(), 'File'), 'file.save')).toEqual({
      kind: 'command',
      id: 'file.save',
      title: 'Save',
      // The `code` spelling, so a menu item and the keymap are the same
      // physical key on every layout.
      accelerator: 'Command+KeyS',
      enabled: false,
    });
  });

  it('leaves a command with no shortcut without one', () => {
    expect(command(menu(bar(), 'View'), 'view.files')).toMatchObject({ accelerator: null });
  });

  it('greys out what cannot run, and only that', () => {
    const off = menu(bar(), 'File');
    expect(command(off, 'file.save')?.enabled).toBe(false);
    expect(command(off, 'file.new')?.enabled).toBe(true);
    expect(command(menu(bar({ canSave: true }), 'File'), 'file.save')?.enabled).toBe(true);
  });

  it('puts Settings in the application menu, where macOS keeps it', () => {
    expect(ids(menu(bar(), 'Markdown'))).toEqual(['file.settings']);
    expect(ids(menu(bar(), 'File'))).not.toContain('file.settings');
  });

  it('quits through the app rather than through AppKit', () => {
    // The standard Quit is `terminate:`, which reaches the app too late
    // to ask a window for anything. Rust builds this one itself.
    expect(roles(menu(bar(), 'Markdown'))).toEqual([
      'about',
      'services',
      'hide',
      'hide_others',
      'show_all',
      'quit',
    ]);
  });

  it('opens Edit with undo and redo, then the clipboard', () => {
    const edit = menu(bar(), 'Edit');
    expect(ids(edit).slice(0, 2)).toEqual(['edit.undo', 'edit.redo']);
    expect(roles(edit)).toEqual(['cut', 'copy', 'paste', 'select_all']);
    // Undo is not one of the standard items, on purpose: `undo:` is
    // WebKit's undo and the editor's history is CodeMirror's.
    expect(roles(edit)).not.toContain('undo');
  });

  it('puts Paste and Match Style beside Paste, not among the marks (ADR 0041)', () => {
    const edit = lines(menu(bar(), 'Edit'));
    expect(edit.slice(0, 8)).toEqual([
      'edit.undo',
      'edit.redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'edit.pastePlain',
      'select_all',
    ]);
    expect(edit.filter((line) => line === 'edit.pastePlain')).toHaveLength(1);
  });

  it('turns the other paste on only where there is an editor', () => {
    const on = (over: Record<string, unknown>) =>
      command(menu(bar(over), 'Edit'), 'edit.pastePlain')?.enabled;
    const doc = (mode: string) => ({
      activeDoc: {},
      activeTab: { id: 't', kind: 'document', mode },
    });
    expect(on(doc('edit'))).toBe(true);
    expect(on(doc('source'))).toBe(true);
    expect(on(doc('read'))).toBe(false);
    expect(on({ activeTab: { id: 'p', kind: 'pdf' } })).toBe(false);
    expect(on({})).toBe(false);
  });

  it('says what pinning the tab in front would do', () => {
    const pin = (over: Record<string, unknown>) => command(menu(bar(over), 'Go'), 'go.pin');
    expect(pin({ activeTab: { id: 't', kind: 'document' } })).toMatchObject({ title: 'Pin Tab' });
    expect(pin({ activeTab: { id: 't', kind: 'document' }, activePinned: true })).toMatchObject({
      title: 'Unpin Tab',
    });
  });

  it('offers no Close Window, because Cmd+W is Close Tab here', () => {
    expect(roles(menu(bar(), 'Window'))).toEqual(['minimize', 'zoom', 'bring_all_to_front']);
    expect(ids(menu(bar(), 'File'))).toContain('file.close');
  });

  it('never lists the same command twice', () => {
    const all = bar().flatMap((section) => ids(section.items));
    expect(all.length).toBe(new Set(all).size);
  });

  it('lists every command the palette lists', () => {
    const registry = new CommandRegistry(true);
    registry.register(...appCommands(workspace()));
    const shown = new Set(menuBar(registry).flatMap((section) => ids(section.items)));
    const missing = registry.listed().filter((command) => !shown.has(command.id));
    expect(missing.map((command) => command.id)).toEqual([]);
  });
});

describe('the editor menu (ADR 0041)', () => {
  const inEditor = { activeDoc: {}, activeTab: { id: 't', kind: 'document', mode: 'edit' } };
  const inRead = { activeDoc: {}, activeTab: { id: 't', kind: 'document', mode: 'read' } };

  function lines(over: Record<string, unknown>) {
    const registry = new CommandRegistry(true);
    registry.register(...appCommands(workspace(over)));
    return editorMenu(registry);
  }

  it('is the clipboard, both pastes, then the four marks', () => {
    expect(
      lines(inEditor).map((item) =>
        item.kind === 'standard' ? item.role : item.kind === 'command' ? item.id : 'separator',
      ),
    ).toEqual([
      'cut',
      'copy',
      'paste',
      'edit.pastePlain',
      'separator',
      'edit.bold',
      'edit.italic',
      'edit.link',
      'edit.code',
    ]);
  });

  it('names the other paste as macOS does, with its key', () => {
    expect(command(lines(inEditor), 'edit.pastePlain')).toEqual({
      kind: 'command',
      id: 'edit.pastePlain',
      title: 'Paste and Match Style',
      accelerator: 'Command+Shift+KeyV',
      enabled: true,
    });
  });

  it('greys every command out with nothing open', () => {
    const commands = lines({}).filter((item) => item.kind === 'command');
    expect(commands).toHaveLength(5);
    expect(commands.every((item) => item.kind === 'command' && !item.enabled)).toBe(true);
  });

  it('greys the other paste out where there is no editor to paste into', () => {
    expect(command(lines(inRead), 'edit.pastePlain')?.enabled).toBe(false);
    // The marks still work from Read mode, through the document's state.
    expect(command(lines(inRead), 'edit.bold')?.enabled).toBe(true);
  });
});
