import type { MenuEntry, MenuRole, MenuSection } from '@markdown/ipc';
import { type Command, type CommandRegistry, type MenuGroup, titleOf } from './commands.ts';

/**
 * The macOS menu bar (build plan section 8), laid out here because this
 * is where the commands are.
 *
 * Nothing in the bar is written twice: every item that does something the
 * app can do is one of the registry's commands, carrying the id, the name
 * and the key it was registered with, so a command added to
 * `app-commands.ts` appears in the palette, the keymap and the menu with
 * no third place to remember (plan WP 1.3). What is added here is the
 * ordering the platform expects and the standard items, which do not
 * belong to the app at all: Copy is AppKit's `copy:` down the responder
 * chain, and naming it is the most this side can do.
 *
 * Undo is the exception that proves it. It looks like a standard item and
 * is one of the app's commands, because `undo:` is WebKit's undo and the
 * editor's history is CodeMirror's — see `Workspace.undo`.
 */
const SEPARATOR: MenuEntry = { kind: 'separator' };

const standard = (role: MenuRole): MenuEntry => ({ kind: 'standard', role });

function item(command: Command, enabled: boolean): MenuEntry {
  return {
    kind: 'command',
    id: command.id,
    title: titleOf(command),
    accelerator: command.accelerator === '' ? null : command.accelerator,
    enabled,
  };
}

/**
 * Settings is registered in the File group, because that is where it is
 * on the platforms that have no application menu. On macOS it lives in
 * the application menu instead, which is the one place a reader looks
 * for it.
 */
const SETTINGS = 'file.settings';
/** Read as one pair at the top of Edit, above the clipboard. */
const HISTORY = ['edit.undo', 'edit.redo'];
/** The other paste, which sits beside the standard one (ADR 0041). */
const PASTE_PLAIN = 'edit.pastePlain';
/** The four inline marks, in the order the keys are learnt. */
const MARKS = ['edit.bold', 'edit.italic', 'edit.link', 'edit.code'];

export function menuBar(registry: CommandRegistry): MenuSection[] {
  const grouped = new Map<MenuGroup, Command[]>(
    registry.menus().map((menu) => [menu.group, menu.items]),
  );
  const entries = (group: MenuGroup, keep: (command: Command) => boolean = () => true) =>
    (grouped.get(group) ?? [])
      .filter(keep)
      .map((command) => item(command, registry.isEnabled(command)));
  const settings = entries('File', (command) => command.id === SETTINGS);
  const history = entries('Edit', (command) => HISTORY.includes(command.id));
  return [
    {
      title: 'Markdown',
      items: [
        standard('about'),
        SEPARATOR,
        ...settings,
        ...(settings.length > 0 ? [SEPARATOR] : []),
        standard('services'),
        SEPARATOR,
        standard('hide'),
        standard('hide_others'),
        standard('show_all'),
        SEPARATOR,
        standard('quit'),
      ],
    },
    { title: 'File', items: entries('File', (command) => command.id !== SETTINGS) },
    {
      title: 'Edit',
      items: [
        ...history,
        SEPARATOR,
        standard('cut'),
        standard('copy'),
        standard('paste'),
        ...entries('Edit', (command) => command.id === PASTE_PLAIN),
        standard('select_all'),
        SEPARATOR,
        ...entries(
          'Edit',
          (command) => !HISTORY.includes(command.id) && command.id !== PASTE_PLAIN,
        ),
      ],
    },
    {
      title: 'View',
      items: [...entries('View'), SEPARATOR, standard('fullscreen')],
    },
    { title: 'Go', items: entries('Go') },
    // No Close Window here. The standard item comes with Cmd+W built into
    // it and no way to change that, and in this app Cmd+W closes the tab
    // in front; a second item on the same key would be one that never
    // fires. Closing a window is the red light in the corner until there
    // is a command of the app's own for it.
    {
      title: 'Window',
      items: [standard('minimize'), standard('zoom'), SEPARATOR, standard('bring_all_to_front')],
    },
    { title: 'Help', items: entries('Help') },
  ];
}

/**
 * The editor's right-click menu (ADR 0041): the clipboard, with the paste
 * that matches style beside the one that keeps it, then the four inline
 * marks. Short on purpose. The webview's own menu, which this replaces,
 * offered Font and AutoFill to a markdown file; what it had that this
 * cannot is the spelling suggestions on a misspelled word, which live
 * behind an API the webview does not expose.
 */
export function editorMenu(registry: CommandRegistry): MenuEntry[] {
  const command = (id: string) => {
    const found = registry.get(id);
    return item(found, registry.isEnabled(found));
  };
  return [
    standard('cut'),
    standard('copy'),
    standard('paste'),
    command(PASTE_PLAIN),
    SEPARATOR,
    ...MARKS.map(command),
  ];
}

/**
 * Keep the bar current: what is greyed out and what an item is called
 * follow the window's state, so the description is rebuilt whenever
 * anything it reads has changed. Returns the function that stops it.
 */
export function watchMenu(
  registry: CommandRegistry,
  draw: (sections: MenuSection[]) => void,
): () => void {
  return $effect.root(() => {
    $effect(() => {
      draw(menuBar(registry));
    });
  });
}
