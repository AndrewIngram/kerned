# Extension keyboard shortcuts

An extension contributes shortcuts through the browser adapter. The headless
session still owns commands, transactions, permissions and history; it does not
listen for DOM events.

```ts
import { defineExtension, type ContributionContext } from '@gprose/core';
import { keyboardShortcuts } from '@gprose/view';

const historyKeys = defineExtension({
  name: 'historyKeys',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(keyboardShortcuts, {
      key: 'Mod-Shift-z',
      run({ editor }) {
        editor.transact((draft) => draft.restoreHistory('redo'));
        return true;
      },
    });
    return {};
  },
});
```

Register during extension setup. Configured extension options can determine keys
and priority. A handler receives the live imperative session and original
`KeyboardEvent`; use the command definitions exported by an extension for edits.
Do not retain a transaction or a numeric selection offset between events.

## Matching and precedence

- `key` is a `KeyboardEvent.key` preceded by zero or more `Mod-`, `Control-`,
  `Meta-`, `Alt-`, or `Shift-` modifiers. For example: `Enter`, `Mod-b`,
  `Alt-ArrowDown`, and `Mod-Shift-z`. Key names are case insensitive; modifier
  names are case sensitive. Use `Space` for a space and `Minus` for a hyphen.
- `Mod` means Command on Apple platforms and Control elsewhere. Native adapters
  can pass an explicit platform to `createKeyboardShortcuts`.
- Modifiers match exactly. `Mod-b` does not consume `Mod-Shift-b` or
  `Mod-Alt-b`. AltGraph and IME composition keys bypass the registry.
- Higher `priority` runs first. The default is `0`; equal priorities retain
  extension installation order and contribution order within an extension.
- Return `true` to handle the event. Dispatch prevents its native default and
  stops. Return `false` without changing editor state or causing side effects to
  try the next matching shortcut. If all decline, ordinary input/navigation
  policies and finally the browser can handle the key.
- Already prevented events do not run again. A handler that calls
  `preventDefault()` also stops dispatch, even if it returns `false`.
- Invalid modifier combinations and non-finite priorities fail when the view
  assembles its shortcuts. A callback exception consumes the key and propagates
  to its caller: it never causes a second handler or native edit. The supplied
  canvas and table adapters report the error through the editor notice callback.

The starter input extension registers bold, italic, underline, undo and redo at
priority `-100`. An ordinary extension can override these without depending on
its position relative to the starter kit. These built-ins retain both Control
and Command bindings on all platforms. They consume recognized keys even if
permissions reject the command or there is nothing to undo, preventing native
textarea history from diverging from document history.

## Native node views

Canvas input automatically dispatches the registry. A native editable node view
can create `const dispatch = createKeyboardShortcuts(editor)` once in its factory
and call `dispatch(event)` from its editing control's `keydown` listener. Stop
when it returns `true`; otherwise continue that control's own keyboard behavior.
Track composition start/end as well as `event.isComposing` before dispatching,
since browsers differ in composition event ordering. The starter table view
uses this same contract for cell text and grid selection.

This function installs no global or root listener. Buttons, menus, and unrelated
inputs in interactive node views keep their native behavior unless that view
explicitly opts them in. Never call a retained dispatcher after destroying its
editor. Session destruction makes it unusable; it owns no independent resources
that require disposal.

Input and paste transformations have their own transactional registries; see
[Input and paste rules](input-and-paste-rules.md).
