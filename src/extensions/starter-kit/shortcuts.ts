import { formattingCommands } from '@gprose/extension-document';
import type { KeyboardShortcut } from '@gprose/view';

/** Built-ins run after ordinary extension shortcuts. Both physical modifiers
 * preserve the editor's existing Control/Command bindings on every platform. */
export const starterKeyboardShortcuts: readonly KeyboardShortcut[] = ['Control', 'Meta'].flatMap(
  (modifier): KeyboardShortcut[] => [
    ...(['bold', 'italic', 'underline'] as const).map((format): KeyboardShortcut => ({
      key: `${modifier}-${format[0]}`,
      priority: -100,
      run({ editor }) {
        editor.transact((draft) => draft.command(formattingCommands.toggleFormat, format));

        return true;
      },
    })),
    ...(['undo', 'redo'] as const).map((direction): KeyboardShortcut => ({
      key: `${modifier}-${direction === 'redo' ? 'Shift-' : ''}z`,
      priority: -100,
      run({ editor }) {
        editor.transact((draft) => draft.restoreHistory(direction));

        return true;
      },
    })),
  ],
);
