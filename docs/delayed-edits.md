# Delayed edits

`createPendingEdit` captures the current caret or a contiguous selection before
an asynchronous request begins. It uses the existing durable position system;
the document does not register a new range ID. Pass an explicit selection as the
second argument to target another location. An empty document or a noncontiguous
selection, such as a table rectangle, returns `null`.

```ts
const pending = createPendingEdit(editor);
if (!pending) return;

try {
  const response = await fetch('/suggestion', { signal: pending.signal });
  const text = await response.text();
  const result = pending.commit((draft, ranges) => {
    draft.step({ kind: 'replaceRanges', ranges, text, pruneEmpty: [] });
    return true;
  });
  // Report deleted/unavailable/rejected targets in the application's UI.
} finally {
  pending.cancel();
}
```

Cancel the previous pending edit when a request is superseded or its owning UI
is removed. Cancelling aborts its signal and prevents any later commit. Destroying
the editor session cancels pending edits automatically. Removing a view alone
does not cancel a request against a surviving borrowed session.

Commit resolves the captured target after intervening moves, splits and edits.
A range includes content inserted within it. The callback receives the resulting
text/node ranges and a fresh imperative command draft. It must return a boolean
synchronously. Do the asynchronous work before committing, and validate external
responses before constructing steps. A caret becomes a zero-length text range.

The transaction checks the current permission policy for its actual operations.
There is no blanket access check that would incorrectly prevent deleting an
unlocked read-only node. A failed command or denied step publishes nothing and
returns `rejected`. The current selection is preserved and mapped by the normal
transaction rules unless the callback explicitly changes it. Each commit forms
a separate undo event by default; command options can override this.

The result is `applied`, `rejected`, `deleted`, `unavailable`, `cancelled` or
`settled`. Unavailable references include the existing resolver's reason. Each
pending edit permits one commit attempt. Even a rejected command or thrown
exception consumes that attempt. Exceptions still propagate; arbitrary callback
failures are not disguised as permission denial. Completed requests detach their
session listener and do not abort later when the session is destroyed.

The `target` property contains serializable coordinates. It is not a document
snapshot, request registry, collaboration state or replacement for a reference
checkpoint. Persist the matching document/reference checkpoint when storing
references across sessions. The pending request and its AbortSignal remain local
to the process. If a suggestion requires unchanged source text, the integration
must also check that precondition in its commit callback; durable coordinates do
not imply that the target's content is unchanged.
