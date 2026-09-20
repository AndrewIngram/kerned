# Wordgard architecture research

Verified against official documentation on 2026-09-20. Web-reader requests failed, but direct HTTPS downloads succeeded. This note distinguishes documented behavior from recommendations for gprose; it does not propose adopting Wordgard as a dependency.

## Relationship to ProseMirror

Wordgard explicitly describes itself as another iteration of ProseMirror's design, with interfaces and naming designed from scratch. Existing ProseMirror integration code requires rewriting. It is neither a compatible upgrade nor evidence that Tiptap's interfaces can be reused unchanged. Its modules separate documents/transforms, state, commands, history, collaboration, schema packages, and the editor. [Official migration guide](https://wordgard.net/docs/prosemirror/)

The FAQ leaves 1.0 timing open and anticipates learning from use before stabilizing interfaces. Treat its architecture as a useful reference, not a stable API contract for this proposal. [FAQ](https://wordgard.net/docs/faq/#h-when-will-version-10-be-released)

## Verified architectural choices

### Documents, positions, and identity

- Documents are immutable trees. Non-leaf nodes are `Plot`; leaves include text and atoms. Nodes have a type, one parameter value, and marks. Marks also represent optional block properties. Text runs with matching marks merge into a canonical representation. Node values have no meaningful object identity: the same object may appear at several document locations. [System guide: documents](https://wordgard.net/docs/guide/#h-documents)
- Positions count UTF-16 text units, opening/closing container tokens, and atomic leaves. Changes map positions with association and deletion tracking. This is an address system, not stable semantic node identity. [System guide: index system](https://wordgard.net/docs/guide/#h-index-system)
- Node/mark type objects exist independently of schemas. Schemas compose those types and can override their relationships. Parent constraints use permitted child types and emptiness, replacing ProseMirror content expressions; richer invariants belong in corrections. [Migration guide: schema structure](https://wordgard.net/docs/prosemirror/#h-schema-structure)

### Transactions and extensions

- A `ChangeSet` describes replacements and mark modifications in one delta; it also maps positions and supports composition/transformation. Multiple changes in a specification address the starting document. Immutable transactions are built from specifications and include selection, annotations, and mappable effects. [Migration guide: transactions and changes](https://wordgard.net/docs/prosemirror/#h-transactions-and-changes)
- Extension configuration forms a tree. Typed facets combine contributed values under explicit precedence; immutable state fields reduce previous values plus transactions. View plugins have a separate lifecycle. Schema contributions, key bindings, and menus can travel in one feature bundle. [Migration guide: configuration](https://wordgard.net/docs/prosemirror/#h-configuration), [system guide: configuration](https://wordgard.net/docs/guide/#h-configuration)
- Commands accept an editor and optional parameter; they may act, return a transaction specification, or decline. Extensions can attach handlers to generic commands, ordered by precedence. This provides extensible behavior, but does not itself establish Tiptap-style chaining or a side-effect-free capability query. [System guide: commands](https://wordgard.net/docs/guide/#h-commands)

### View and decorations

- Wordgard's editor renders editable DOM. It uses input events, owns selection movement and cursor drawing, and still handles browser composition. It is not a canvas renderer. View updates receive transactions; DOM updates may be deferred, with geometry queries forcing freshness. [Migration guide: editor](https://wordgard.net/docs/prosemirror/#h-editor)
- Point/range decorations use separate mappable collections, which also support arbitrary position-associated data. Type-wide tag decorations replace node views. Their DOM descriptions are not a ready-made canvas projection API. [Migration guide: decorations](https://wordgard.net/docs/prosemirror/#h-decorations)

### Collaboration

Bundled collaboration uses operational transformation with a central authority. Its example lacks production reconnection, persistence, and complete validation. Transforming structural changes requires the starting document. Corrections need coordinated ownership; server and client must apply matching rules when transforming. Independently running fixes on every peer can duplicate changes or loop. [Official collaboration example](https://wordgard.net/examples/collab/)

## Implications for gprose — recommendations, not Wordgard claims

1. Adopt the separation between document values, extensible state, transactions, and an imperative view. Give the canvas view each transaction's changes and mapping so it can invalidate layout precisely.
2. Define one owned generic node/mark protocol with application-supplied schema types. Keep feature types reusable across schemas; avoid teaching core editing logic about specific demo paragraphs or comments.
3. Separate interned type/mark identities from document occurrence identity. If stable node IDs are required, specify copy, split, join, paste, and deletion semantics. Wordgard does not supply justification for treating interned node values as stable occurrences.
4. Store comment records outside document content, with explicit mapped anchor ranges and deletion policy; derive canvas decorations from those anchors. This is a product decision, not a documented Wordgard comments implementation.
5. Make a Tiptap-like facade build one atomic transaction over the imperative core. Specify whether chain steps address initial or evolving state, and keep capability checks free of side effects. Wordgard demonstrates extensible commands but does not answer those facade contracts for us.
6. Let React adapt lifecycle and subscribe to derived state. The headless core and canvas runtime should own document edits, selection, history, input, and layout. No verified React-specific Wordgard adapter was investigated here.
7. Prepare mapping, inversion, origin metadata, and deterministic normalization before committing to a collaboration transport. Choosing OT or CRDT requires its own decision; neither should be implied merely by borrowing this extension architecture.
