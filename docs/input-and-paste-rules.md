# Input and paste rules

Extensions can transform typing or handle pasted content without owning a DOM
textarea, mutating nodes, or replacing the editor's clipboard implementation.
Both registries use descending priority (default `0`) and installation order for
ties. Each attempt receives a fresh transaction. Returning `false` discards its
steps, selection changes and queued effects before trying the next rule. The
first successful `true` result stops dispatch. Permission checks apply at commit.

## Transform typed text

Input rules belong to the headless core. The starter browser input and native
table views invoke them after successful text insertion.

```ts
import { defineExtension, inputRules, type ContributionContext } from '@gprose/core';
import { textSelection } from '@gprose/state';

const smartDash = defineExtension({
  name: 'smartDash',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(inputRules, {
      find: /--/,
      run({ transaction, range }) {
        transaction.apply({
          steps: [{ kind: 'replaceText', ...range, text: '—' }],
          selection: textSelection(range.id, range.from + 1),
          input: true,
        });
        return true;
      },
    });
    return {};
  },
});
```

`find` matches the current text node before its caret, with an implicit absolute
end anchor. The handler receives the regex `match` and `{ id, from, to }` range.
Global/sticky regex state is not shared across calls. Empty matches and matches
starting inside a grapheme are skipped. A rule can use schema bindings or an
extension's command definitions to change a block type, marks, or structure.
It does not need to know the node's stored text field name.

Only collapsed text selections are eligible. Ordinary imperative commands,
deletion, paste and drop do not implicitly run typing rules. Input rules are
opt-in contributions; the starter kit does not add automatic substitutions.

The literal insertion and the transformation are separate transactions/history
entries. Undo first restores the literal characters, then earlier typing. Redo
replays the accepted transformation without calling the rule again. This does
not implement a special Backspace-to-undo-rule command. A rejected rule or an
exception cannot discard the literal input already accepted by the editor.

IME updates retain ordinary composition history and never transform provisional
text. The adapters wait until final composition input has been delivered. A
pending rule is discarded if the selection or document revision changed in the
meantime. An unchanged trailing input event does not create a new transaction or
consume the pending composition.

Custom native text adapters can create `createInputRules(editor)` once, then call
`input({ text, composing })` after a successful insertion. Skip it for paste/drop
and unchanged input events. Call `endComposition()` after final native input,
cancel scheduled callbacks on unmount, and synchronize native input after a
transformation. The supplied adapters already implement this routing.

`editor.getNode(id)` reads the current canonical node through the session's tree
index, including nested nodes. It returns `undefined` for an absent ID and
rejects use after destruction. It does not clone or traverse the document.
Input-rule matching uses this lookup only when rules are installed.

## Handle pasted content

Paste rules belong to the browser adapter and run before ordinary rich/plain
paste, including native table clipboard handling.

```ts
import { pasteRules } from '../src/editor-browser';
import { editingCommands } from '../src/extensions/starter-kit/commands';

// Inside extension setup:
context.provide(pasteRules, {
  run({ transaction, clipboard }) {
    const text = clipboard.getData('text/plain');
    if (text !== ':wave:') return false;
    return transaction.command(editingCommands.insertText, 'Hello');
  },
});
```

The read-only clipboard interface provides `types` and `getData(type)`. Values
are read lazily and cached during dispatch; copying large HTML is unnecessary
for a rule interested only in plain text. Read any data needed for delayed work
synchronously inside the handler. File upload and suggestion interfaces remain
separate integrations; use the durable-target contract in
[Delayed edits](delayed-edits.md) for asynchronous work.

A successful rule owns the event and prevents the ordinary paste handler and
native default from running again. If all rules decline, the existing clipboard
path retains rich formatting, inline values and table rectangles. Ordinary text
paste in a native cell remains native when no rule or rectangle handler owns it.
Its subsequent input event does not invoke typing rules. Native paste and drop
input also create separate undo entries from preceding and following typing, in
both table cells and canvas text capture.

An exception rolls back the attempted draft, consumes the event and reports the
error through the mounted editor's notice callback. It does not fall through to
a second paste implementation. Direct users of `createPasteRules(editor)` get
the exception and must apply the same event ownership policy. A handled paste
is one normal undoable transaction.

Neither rule type supports asynchronous handlers. Use `transaction.effect` for
effects that should run only after a successful commit; direct side effects in a
handler cannot be rolled back. No rules run after their editor is destroyed.
