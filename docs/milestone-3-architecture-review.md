# Milestone 3 architecture review

Reviewed the complete implementation range `c3cdf8b..5ad50fe`, including the
intermediate milestone 3 checkpoints. This is an independent review using the
`improve-codebase-architecture` and `codebase-design` criteria, with emphasis on
the public editor and extension interfaces. The review uses the existing Tiptap
audit and package architecture as design evidence; it does not require API parity
with Tiptap or ProseMirror.

## Recommendation

**Accept milestone 3.** Both findings below were addressed in the post-review
worktree and independently rechecked. The implementation owner reports passing
full checks and build; final formatting and type checks should cover the small
follow-up fixtures added during this recheck before committing.

Both findings concerned the same public composition seam: the capabilities
exposed by a session must faithfully reflect the assembled definitions. The
fixes preserve that contract without changing editing semantics.

The implementation has substantially improved module depth. Named commands,
nested commands, dry runs, native input and toolbar actions now share the state
module's draft implementation. Session-owned cleanup, publication and view
effects remove lifecycle ordering responsibilities from callers. Portable
starter commands use schema operations and bound constructors instead of
capturing the demo's node union. These modules pass the deletion test: deleting
them would spread real editing and lifecycle responsibilities back into adapters.

## Findings

### P2 — Conditional contributions expose methods that do not exist

**Status: resolved.**

**Location:** `src/core/session.ts:53–67`, with construction compatibility at
`src/core/session.ts:70–82` and runtime registration in `src/core/commands.ts:39–48`
and `src/core/queries.ts`.

`Installed` distributes over contribution unions and keeps the branch containing
a commands or queries property. It then exposes those names as required methods.
The runtime registry only installs names returned by the actual factory. A
configured extension can therefore compile successfully while exposing missing
methods through the public session interface:

```ts
const conditional = defineExtension({
  name: 'conditional',
  options: { enabled: false },
  setup: (options) =>
    options.enabled
      ? {
          commands: { ping: defineCommand({ execute: () => true }) },
          queries: { answer: () => 42 },
        }
      : {},
});

// After composing this extension with a text node:
const command: () => boolean = editor.commands.ping;
const query: () => number = editor.queries.answer;
```

**Evidence:** a virtual consumer fixture compiled using the repository's
TypeScript configuration with no diagnostics. Executing the same definitions
through Vite's SSR loader reported both properties as `undefined`. Calling either
method would throw. The same mismatch affects chain, dry-run and command-state
entry points derived from `Installed`.

**Recommended fix:** require stable installed command and query names for a
statically typed assembly. Reject conditional or optional capability shapes at
session construction; command availability already has an explicit `false`/`can`
contract. An alternative is to preserve optionality throughout every invocation
form, but that expands the interface and makes chaining harder to use. Keep the
validation local to composition so every adapter receives the same guarantee.

Take care with `ContentDefinition.setup`: its builder currently declares
`Contribution | undefined` even when a setup factory was supplied. Do not mistake
that implementation detail for an intentionally conditional capability. Retain
or establish the distinction in the definition contract.

**Verification:** negative compile fixtures for conditional namespaces,
conditional names within a namespace, optional command/query members and an
optional factory result. Include positive fixtures for ordinary node/mark setup
factories and stable commands that return `false` when disabled. Where dynamic
assemblies remain supported, their runtime checks must not claim statically
guaranteed methods.

This is a strong deepening opportunity: the composition module should own the
invariant once, preserving leverage at every caller and locality in its tests.

### P2 — The session narrows away assembled mark and inline factories

**Status: resolved.**

**Location:** `src/core/session.ts:84–95` and `src/core/session.ts:113`;
compare `src/model/assembly.ts:99–117`.

The assembled schema exposes typed `marks` and `inline` factories. The session
stores that exact schema object, but publishes a separate `SessionSchema<D, N>`
contract that omits both factories. Valid calls through the original assembly
therefore fail through the session:

```ts
schema.marks.create('bold', null);
schema.inline.create('mention', 'mention-1', 0, { user: 'alice' });

editor.schema.marks.create('bold', null); // Property 'marks' does not exist.
editor.schema.inline.create('mention', 'mention-1', 0, { user: 'alice' });
// Property 'inline' does not exist.
```

**Evidence:** a virtual TypeScript consumer fixture confirmed the missing-property
diagnostics, while the corresponding calls on `schema` compiled. Runtime schema
ownership has not changed; only its public type has lost these capabilities.

Consumers building custom marks and inline objects must keep a parallel assembly
handle, even though the session already exposes `schema`. This weakens the
composed session's interface and creates unnecessary knowledge across the model
and core seam.

**Recommended fix:** preserve the assembled schema contract, including its typed
mark and inline factories, on `editor.schema`. Reuse or derive it from the model
contract rather than maintaining a narrower duplicate. Do not widen names or
attributes to strings/unknown simply to restore access.

**Verification:** public consumer fixtures should construct installed marks and
inline objects through `editor.schema`, infer their discriminants and attributes,
and reject unknown names, wrong attributes and missing required attributes. The
session should still expose the same schema object at runtime.

This is a strong improvement to locality: the model module remains the owner of
the schema interface, and the core module carries that contract through without
making consumers reconcile two views of the same object.

## Resolution recheck

The independent recheck inspected the shared worktree changes following the
pre-review commit and the public fixtures in
`src/core/__tests__/capability-contract.test.ts`.

- Composition now validates each assembly tuple slot before distributing its
  definitions. Conditional namespaces, optional members, differing command
  signatures and optional factory results cannot promise required session
  methods. Variable-length arrays do not claim statically installed names.
  Stable commands remain installed when disabled and report availability through
  their return value, direct calls, dry runs and command-state queries.
- `DefinitionContribution` distinguishes the content builder's empty setup path
  from a supplied factory's return contract. An independent virtual consumer
  confirmed that a raw optional factory with all required schema metadata is
  rejected specifically by the stability guard; a supplied `defineNode` factory
  returning `undefined` rejects at the builder. Existing node, mark and inline
  contribution fixtures retain their positive contracts.
- The recheck also caught non-string capability names: symbols were omitted by
  runtime registration, and numeric command-state names did not match string map
  keys. The same composition guard now rejects these shapes, with separate
  symbol-command, symbol-query and numeric-command fixtures. An independent
  virtual consumer confirmed rejection by `sessionCapabilitiesMustBeStable`.
- The model-owned `SchemaValues` contract carries typed mark and inline factories
  through both assembly and session. This avoids a parallel factory definition
  and does not force recursive document-node inference through the session
  contract. Valid construction calls through `editor.schema` now compile;
  negative fixtures retain unknown-name and invalid-attribute rejection, and a
  runtime test verifies schema object identity and constructed values.

These changes improve locality at the existing composition seam. No additional
runtime registry, editing path or consumer-side guard was introduced. The added
type machinery enforces an explicit public invariant rather than exposing that
complexity to extension users. There are no remaining required findings from
this review.

The implementation owner reports the post-review full check and build passing
with **253 Vitest passes, one unchanged convergence todo and 39 Playwright
passes**. The last non-string-key changes affect types and compile fixtures only;
the owner subsequently completed the full check again, including type/lint/format
and all browser scenarios. A second fix/format pass changed no files. Production
editing code did not change in these review fixes, so the previously recorded
performance evidence remains applicable.

## Reviewed behavior without additional required findings

- Draft edits share one implementation and poison the complete chain on failure.
  Input marks are recorded on operations so a later command cannot silently
  change the formatting of an earlier insertion. Stale snapshots and current
  permissions are checked before publication.
- History preparation does not move stacks. Replay rechecks the history version,
  permissions and extension fields before publication. The documented restriction
  against mixing replay and new edits in one chain is explicit, tested and
  acceptable for this milestone.
- Event channels distinguish document content from selection and view invalidation.
  Listener snapshots and guarded publication prevent synchronous recursive edits
  from corrupting the publication sequence.
- Session disposal releases a mounted view before extension resources; partial
  initialization disposes acquired resources in reverse order. The lifetime
  module earns its seam by covering both successful and failed construction.
- The view-effects adapter owns attachment identity. A deferred request cannot
  be delivered to a replacement view or revive a destroyed session.
- Starter commands retain foreign descendants through schema operations, and
  native input invokes the same named commands as programmatic edits. The old
  snapshot-dependent action assembly has been removed.

The implementation validation recorded in `docs/public-interface-progress.md`
reports 249 passing Vitest cases, one unchanged convergence todo, 39 passing
Playwright scenarios, declaration emission, build and all unchanged production
performance budgets. This review inspected the relevant contracts and tests and
ran the targeted consumer reproductions above; it did not rerun the full suite.

## Explicitly deferred scope

Complete graphics, input and layout ownership belongs to milestone 4; the current
React canvas hooks and demo graphics initialization are not accepted as the final
view interface. Configurable typography, rendering contributions, static codecs,
input-rule registration and built workspace consumers remain milestones 5–8.
Starter renderer projection and browser codecs still being tied to starter node
types is tracked there. Concurrent rebasing and collaborative undo are separate
future work; this review does not treat the local-history contribution as a
collaboration provider interface or claim the existing convergence todo is solved.
