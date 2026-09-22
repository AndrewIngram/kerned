import { defineContribution } from '@gprose/core';
import type { NodeIdentity } from '@gprose/model';

import type { ViewSession } from './input-contributions.js';

export type KeyboardShortcut = {
  /** KeyboardEvent.key with optional Mod, Control, Meta, Alt and Shift prefixes. */
  readonly key: string;
  /** Higher values run first; ties retain extension installation order. Default: 0. */
  readonly priority?: number;
  /** Return true to consume the event, false to leave it to the next shortcut. */
  run<N extends NodeIdentity>(context: { editor: ViewSession<N>; event: KeyboardEvent }): boolean;
};

export const keyboardShortcuts = defineContribution<KeyboardShortcut>();

/** A native node view opts into the same dispatch as canvas input. Unrelated
 * interactive controls keep their own keyboard behavior. No listener is installed. */
export function createKeyboardShortcuts<N extends NodeIdentity>(
  editor: ViewSession<N>,
  options: { platform?: 'mac' | 'other' } = {},
) {
  const mac = options.platform
    ? options.platform === 'mac'
    : /Mac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? '');

  const shortcuts = keyboardShortcuts
    .read(editor)
    .map((shortcut) => {
      const priority = shortcut.priority ?? 0;

      if (!Number.isFinite(priority)) throw new Error('Shortcut priority must be finite');
      const tokens = shortcut.key.split('-');
      const key = tokens.pop();

      if (!key) throw new Error(`Missing shortcut key: ${shortcut.key}`);
      const modifiers = new Set<string>();

      for (const token of tokens) {
        const modifier = token === 'Mod' ? (mac ? 'Meta' : 'Control') : token;

        if (!['Control', 'Meta', 'Alt', 'Shift'].includes(modifier) || modifiers.has(modifier))
          throw new Error(`Invalid shortcut modifiers: ${shortcut.key}`);
        modifiers.add(modifier);
      }

      return {
        shortcut,
        priority,
        key: key === 'Space' ? ' ' : key === 'Minus' ? '-' : key.toLowerCase(),
        control: modifiers.has('Control'),
        meta: modifiers.has('Meta'),
        alt: modifiers.has('Alt'),
        shift: modifiers.has('Shift'),
      };
    })
    .toSorted((a, b) => b.priority - a.priority);

  return (event: KeyboardEvent): boolean => {
    if (editor.isDestroyed) throw new Error('Editor is destroyed');

    if (event.defaultPrevented) return true;

    // Some IMEs report keyCode 229 without setting isComposing on the first key.
    if (event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph'))
      return false;

    for (const binding of shortcuts) {
      if (
        event.key.toLowerCase() !== binding.key ||
        event.ctrlKey !== binding.control ||
        event.metaKey !== binding.meta ||
        event.altKey !== binding.alt ||
        event.shiftKey !== binding.shift
      )
        continue;

      try {
        if (binding.shortcut.run({ editor, event }) || event.defaultPrevented) {
          event.preventDefault();

          return true;
        }
      } catch (error) {
        // A handler may have already published an edit. Never fall through to a
        // native action or a second handler after a failed extension callback.
        event.preventDefault();
        throw error;
      }
    }

    return false;
  };
}
