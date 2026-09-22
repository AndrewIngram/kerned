import { indexTree, validateTextRange, type NodeIdentity, type Schema } from '@gprose/model';
import { createEditor, AllSelection } from '@gprose/state';

import { documentCoordinates } from '../../../packages/collaboration-lab/src/coordinates.js';
import {
  rebase,
  sameEdit,
  mapSelection,
  type Commit,
  type Edit,
  type Proposal,
  type Presence,
  type PresenceSelection,
  type RemotePresence,
  type PresenceSnapshot,
} from '../../../packages/collaboration-lab/src/protocol.js';

type Session = { principal: string; sequence: number; latest: Presence | null; receivedAt: number };

export type Receipt =
  | { kind: 'accepted'; commit: Commit }
  | {
      kind: 'rejected';
      sequence: number;
      reason: 'generation' | 'version' | 'overlap' | 'precondition' | 'permission' | 'closed';
    };

export function createAuthority<N extends NodeIdentity>(options: {
  schema: Schema<N>;
  nodes: readonly N[];
  generation: string;
  now: () => number;
  presenceLifetime: number;
  canEdit?: (principal: string, node: N) => boolean;
  canSeePresence?: (recipient: string, node: N) => boolean;
}) {
  const { schema, generation } = options;
  const editor = createEditor(schema, options.nodes, new AllSelection(), [], { history: null });
  const commits: Commit[] = [];
  const snapshots = [editor.state.nodes];

  const sessions = new Map<string, Session>();

  let nextSession = 0,
    presenceSequence = 0;

  function resolve(value: PresenceSelection | null, version: number) {
    let result = value;

    for (const commit of commits.slice(version)) result = mapSelection(result, commit.edit);

    return documentCoordinates(schema, editor.state.nodes).normalizeSelection(result);
  }

  function selectionNodes(value: PresenceSelection, nodes = editor.state.nodes) {
    const tree = indexTree(schema, nodes);

    const selected = [value.anchor, value.head].map((point) => {
      const entry = tree.byKey.get(point.key);
      const text = entry && schema.text(entry.node);

      if (!entry || text === undefined || text === null) throw new Error('Invalid presence target');
      validateTextRange(text, point.offset, point.offset);

      return tree.order.indexOf(entry);
    });

    const result = new Map<number, N>();

    for (let entry of tree.order.slice(Math.min(...selected), Math.max(...selected) + 1)) {
      for (;;) {
        result.set(entry.node.id, entry.node);
        const parent = entry.parent === null ? undefined : tree.byId.get(entry.parent);

        if (!parent) break;
        entry = parent;
      }
    }

    return [...result.values()];
  }

  return {
    get nodes() {
      return editor.state.nodes;
    },
    get version() {
      return commits.length;
    },
    get checkpoint() {
      return editor.positions.checkpoint();
    },
    connect(principal: string) {
      const session = `session-${++nextSession}`;

      const state: Session = { principal, sequence: 0, latest: null, receivedAt: 0 };

      sessions.set(session, state);
      const receipts = new Map<number, { request: Proposal; result: Receipt }>();

      return {
        session,
        submit(request: Proposal): Receipt {
          const prior = receipts.get(request.sequence);

          if (prior) {
            if (
              prior.request.generation !== request.generation ||
              prior.request.version !== request.version ||
              !sameEdit(prior.request.edit, request.edit)
            )
              throw new Error('Operation identity reused');

            return structuredClone(prior.result);
          }

          function evaluate(): Receipt {
            const reject = (reason: Extract<Receipt, { kind: 'rejected' }>['reason']): Receipt => ({
              kind: 'rejected',
              sequence: request.sequence,
              reason,
            });

            if (!sessions.has(session)) return reject('closed');

            if (request.generation !== generation) return reject('generation');

            if (request.version > commits.length) return reject('version');

            if (!documentCoordinates(schema, snapshots[request.version]).edit(request.edit))
              return reject('precondition');
            let edit: Edit | null = request.edit;

            for (const accepted of commits.slice(request.version)) {
              edit = rebase(edit, accepted.edit);

              if (!edit) return reject('overlap');
            }

            if (!documentCoordinates(schema, editor.state.nodes).edit(edit))
              return reject('precondition');
            const tree = indexTree(schema, editor.state.nodes);
            const entry = tree.byKey.get(edit.key);

            if (!entry) return reject('precondition');
            let ancestor = entry;

            for (;;) {
              if (options.canEdit && !options.canEdit(principal, ancestor.node))
                return reject('permission');
              const parent = ancestor.parent === null ? undefined : tree.byId.get(ancestor.parent);

              if (!parent) break;
              ancestor = parent;
            }

            editor.dispatch({
              baseRevision: editor.state.revision,
              origin: 'local',
              history: 'separate',
              time: 0,
              steps: [
                {
                  kind: 'replaceText',
                  id: entry.node.id,
                  from: edit.from,
                  to: edit.to,
                  text: edit.text,
                },
              ],
            });

            const commit: Commit = {
              generation,
              version: commits.length + 1,
              session,
              sequence: request.sequence,
              edit,
            };

            commits.push(structuredClone(commit));
            snapshots.push(editor.state.nodes);

            return { kind: 'accepted', commit };
          }

          const result = evaluate();
          receipts.set(request.sequence, {
            request: structuredClone(request),
            result: structuredClone(result),
          });

          return result;
        },
        presence(packet: Presence) {
          if (
            !sessions.has(session) ||
            packet.generation !== generation ||
            packet.version > commits.length ||
            packet.sequence <= state.sequence
          )
            return false;

          if (packet.selection) selectionNodes(packet.selection, snapshots[packet.version]);
          state.sequence = packet.sequence;
          state.latest = structuredClone(packet);
          state.receivedAt = options.now();

          return true;
        },
        readPresence(): PresenceSnapshot {
          if (!sessions.has(session)) throw new Error('Session closed');
          const result: RemotePresence[] = [];

          for (const [id, peer] of sessions) {
            if (
              id === session ||
              !peer.latest ||
              options.now() - peer.receivedAt >= options.presenceLifetime
            )
              continue;
            const selection = resolve(peer.latest.selection, peer.latest.version);

            // This experiment omits restricted selections entirely. Full document
            // projection and authenticated transport remain separate proof gates.
            if (
              selection &&
              selectionNodes(selection).some(
                (node) => options.canSeePresence && !options.canSeePresence(principal, node),
              )
            )
              continue;
            result.push({
              generation,
              session: id,
              sequence: peer.sequence,
              version: commits.length,
              selection,
            });
          }

          return {
            generation,
            recipient: session,
            sequence: ++presenceSequence,
            peers: structuredClone(result),
          };
        },
        leave() {
          sessions.delete(session);
        },
      };
    },
    destroy() {
      editor.destroy();
      sessions.clear();
    },
  };
}
