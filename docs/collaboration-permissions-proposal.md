# Collaboration and partial document access

Status: proposal, 2026-09-20. Complements [positions and ranges](editor-position-proposal.md) and [the editor API](editor-api-proposal.md). No collaboration or permission enforcement is implemented by this document.

## Choosing a collaboration model

Do not assume OT is universally better suited to rich text. Evaluate merge behavior, offline requirements, structural operations, storage and permission boundaries separately. An authority server is compatible with either OT or CRDT replication.

Notion describes an RGA-derived sequence model, Peritext-derived formatting and additional machinery to preserve text identity across block splits. It supports offline and agent workflows. The article is evidence for a purpose-built CRDT, not evidence that a generic editor binding automatically has the same semantics. [Notion engineering article](https://www.notion.com/blog/how-notion-handles-concurrent-editing-with-crdts)

ProseMirror documents an authority that orders accepted changes, with clients rebasing outstanding steps. This is a useful starting point for our server-mediated workflow. [ProseMirror guide](https://prosemirror.net/docs/guide/#collab)

Keep OT-style rebasing provisional and evaluate Automerge as the concrete CRDT candidate. The initial OT preference fits explicit command validation, current versioned transactions and agent proposals, but it is not a claim that CRDTs cannot enforce permissions or that OT is inherently faster. Long disconnected editing and retention costs remain decision inputs. Automerge's text model implements Peritext; its Keyhive integration currently documents document-level access and is alpha. Neither fact establishes support for our node/range access requirements. [Automerge model](https://automerge.org/docs/reference/documents/), [Keyhive guide](https://automerge.org/docs/keyhive/ark-api-guide/)

Implement neither two merge engines nor a generic abstraction that promises an effortless switch. Define the observable requirements first: preserving text across splits, stable references, accepted-operation idempotency, permission checks, undo and explicit conflict outcomes.

## Access capabilities and authority

Editable, read-only and protected are useful presentation states. Underneath, distinguish read-content, edit-text, format, edit-attributes, insert-children, delete, move and manage-access capabilities. Commenting can be another capability. Protecting node content does not by itself specify whether moving the node is permitted.

Locking is a general persisted node property available to every node type, including nodes currently editable by a given user. It is independent of the user's access state and is not a special kind of read-only or protected node. Keep it in common node metadata so schema extensions do not each invent their own lock representation.

Confirmed policy: read-only and protected nodes permit whole-node movement and deletion when the surrounding structural operation is authorized. A locked node cannot be deleted by a principal without edit access to that node. The lock does not imply a movement lock. Deleting an ancestor must enforce locks on descendants too. Lock changes require their own authorization; removing a lock in the same transaction must not bypass its protection.

Distinguish removing a whole node from editing part of its content. Permission to delete a read-only node does not permit rewriting a sentence inside it. Moving protected content preserves its confidentiality; movement is not an implicit grant of read access at the destination.

Resolve effective policy from the principal, node/range identity, ancestors and operation. The application owns ACL storage and rules. The editor provides permission queries, command availability and mandatory validation hooks over each transaction's complete effect. The trusted authority authenticates the principal and independently enforces its policy. Client state is not proof of authorization.

Inspect affected descendants and indirect changes. Deleting a parent can delete protected content. Merging nodes can cross access boundaries. Moving content changes its ancestry and possibly its readers. Validate source, destination and disclosure effects. Undo, normalization, paste and agent operations must use the same boundary.

Resolve or rebase a submitted edit, then check its actual effect against current permissions before committing atomically. Concurrent access changes must have a defined order with content changes. Permission revocation may reject previously optimistic or offline edits. A revoked user cannot be made to forget content already delivered.

For a mixed selection, permit deletion of complete unlocked read-only/protected nodes while validating partial text edits and descendant locks independently. If any effect is forbidden, reject the transaction atomically unless the user explicitly invokes an operation designed to affect only permitted ranges. Do not reject a whole-node deletion merely because its content is read-only, and do not silently apply only part of a requested deletion.

## Hidden content requires a separate client projection

A protected placeholder must replace content before that content is transmitted. Sending the complete document and hiding a block in React or canvas does not implement confidentiality.

The trusted canonical document and a user's projected document may differ in structure and size. Provide an opaque placeholder handle, permitted metadata and capabilities. Do not include hidden descendants, mark attributes, text lengths or history merely to simplify positioning. The product explicitly allows disclosure of existence; additional metadata needs its own policy.

This requires a projection contract alongside schema validation. A placeholder may stand in for a subtree that the normal authoring schema requires. Validate client projections under that contract and validate accepted edits against the canonical schema. Never interpret saving a projected document as replacing the full canonical document.

Positions resolve in a named document/view state. Stable permitted node handles and before/after placeholder boundaries allow editing around protected regions. A client cannot resolve an interior anchor it is not authorized to read. It should receive a restricted result rather than hidden coordinates or an invented nearest text point.

The authority translates accepted operations into each authorized projection. A single global character-offset stream cannot be blindly replayed across views with different content. Both OT and CRDT approaches need a deliberate partial-replication design here. CRDT deployments can partition replicated content or use suitable filtered replication, but arbitrary removal of updates can break dependencies. Yjs documents synchronization by applying the shared document's updates; selective confidentiality is an additional architectural requirement. [Yjs updates](https://docs.yjs.dev/api/document-updates)

Apply projection to snapshots, incremental updates, clipboard/export responses, history, search, outlines, presence, errors and agent context. Revocation removes future access and should clear application-controlled caches; it cannot retract prior disclosure. Permission-redacted content is distinct from readable content whose layout has not loaded yet.

## Mark and range permissions

Separate protecting an annotation from protecting the underlying text. A user might edit visible wording while being unable to remove a required classification mark, or might view a marked passage without editing either text or formatting.

Do not make access enforcement depend on an ordinary removable mark. Use trusted policy attached to stable node identities, anchored ranges or separately identified annotations. Formatting marks can be split, merged and normalized; an individual protected annotation needs identity that survives those operations. If inline text is unreadable, project it as an opaque inline item with permitted metadata, rather than a hidden styling mark over delivered text.

Range policies must define boundary insertion, overlap precedence and inheritance after splitting or moving content. Removing all formatting must not remove access restrictions. Clients cannot elevate access by editing attributes or copying a policy reference.

## Proposed next proof

Before choosing the merge engine permanently, exercise one canonical document with three principals: an editor, a read-only reader and a user who receives a protected placeholder. Test concurrent text edits and split/join, edits around placeholders, deleting or moving a parent of protected content, permission revocation during an outstanding edit, protected inline ranges and agent precondition conflicts.

Check both the resulting document and what each client receives. Passing toolbar checks alone is not enough. This should refine the position/range foundation before implementing a broad collaboration backend.
