import { indexTree, validateTextRange, type NodeIdentity, type Schema } from '@kerned/model';
import { createEditor, AllSelection } from '@kerned/state';
import { applySteps, type Step } from '@kerned/transform';

import { documentCoordinates } from '../../../packages/collaboration-lab/src/coordinates.js';
import {
  mapSelection,
  rebase,
  sameEdit,
  type Commit,
  type Edit,
  type Proposal,
  type Presence,
  type PresenceSelection,
  type PresenceSnapshot,
} from '../../../packages/collaboration-lab/src/protocol.js';
import type { Receipt } from './authority.js';

/** Disposable headless client. One pending proposal makes the coordinate proof
 * small; additional typing queues and mounted session integration are separate gates. */
export function createClient<N extends NodeIdentity>(options: {
  schema: Schema<N>;
  nodes: readonly N[];
  generation: string;
  session: string;
  now: () => number;
  presenceLifetime: number;
}) {
  const { schema, generation, session } = options;
  const confirmed = createEditor(schema, options.nodes, new AllSelection(), [], { history: null });
  const commits: Commit[] = [];
  const buffered = new Map<number, Commit>();
  let pending: { request: Proposal; edit: Edit | null } | null = null;
  let localSelection: PresenceSelection | null = null;

  let proposalSequence = 0,
    presenceSequence = 0;

  let presenceSnapshot: PresenceSnapshot | null = null;
  let receivedPresenceAt = 0;

  function step(edit: Edit): Step<N> {
    const result = documentCoordinates(schema, confirmed.state.nodes).edit(edit);

    if (!result) throw new Error('Edit precondition failed');

    return result;
  }

  function nodes() {
    return pending?.edit
      ? applySteps(schema, confirmed.state.nodes, [step(pending.edit)]).nodes
      : confirmed.state.nodes;
  }

  function validateSelection(value: PresenceSelection | null) {
    if (!value) return;
    const tree = indexTree(schema, nodes());

    for (const point of [value.anchor, value.head]) {
      const node = tree.byKey.get(point.key)?.node;
      const text = node && schema.text(node);

      if (text === undefined || text === null) throw new Error('Unknown selection target');
      validateTextRange(text, point.offset, point.offset);
    }
  }

  return {
    get nodes() {
      return nodes();
    },
    get version() {
      return commits.length;
    },
    get waiting() {
      return pending !== null;
    },
    get selection() {
      return structuredClone(localSelection);
    },
    get checkpoint() {
      return confirmed.positions.checkpoint();
    },
    get history() {
      return confirmed.history;
    },
    propose(edit: Edit): Proposal {
      if (pending) throw new Error('Awaiting previous proposal');
      applySteps(schema, confirmed.state.nodes, [step(edit)]);

      const request: Proposal = {
        generation,
        version: commits.length,
        sequence: ++proposalSequence,
        edit: structuredClone(edit),
      };

      pending = { request, edit: structuredClone(edit) };
      localSelection = documentCoordinates(schema, nodes()).normalizeSelection(
        mapSelection(localSelection, edit),
      );

      return structuredClone(request);
    },
    receive(commit: Commit) {
      if (commit.generation !== generation) throw new Error('Wrong document generation');

      const previous =
        commit.version <= commits.length
          ? commits[commit.version - 1]
          : buffered.get(commit.version);

      if (previous) {
        if (
          previous.session !== commit.session ||
          previous.sequence !== commit.sequence ||
          !sameEdit(previous.edit, commit.edit)
        )
          throw new Error('Conflicting authority version');

        return;
      }

      if (commit.version > commits.length + 64) throw new Error('Resynchronization required');
      buffered.set(commit.version, structuredClone(commit));

      for (;;) {
        const next = buffered.get(commits.length + 1);

        if (!next) break;

        const own =
          pending && next.session === session && next.sequence === pending.request.sequence;

        const visibleChange = pending?.edit ? rebase(next.edit, pending.edit, false) : next.edit;
        confirmed.dispatch({
          baseRevision: confirmed.state.revision,
          origin: 'local',
          history: 'separate',
          time: 0,
          steps: [step(next.edit)],
        });

        if (own) pending = null;
        else {
          if (pending?.edit) {
            const rebased = rebase(pending.edit, next.edit);
            pending.edit =
              rebased && documentCoordinates(schema, confirmed.state.nodes).edit(rebased)
                ? rebased
                : null;
          }

          localSelection = visibleChange ? mapSelection(localSelection, visibleChange) : null;
        }

        localSelection =
          pending && !pending.edit
            ? null
            : documentCoordinates(schema, nodes()).normalizeSelection(localSelection);
        commits.push(next);
        buffered.delete(next.version);
      }
    },
    reject(receipt: Extract<Receipt, { kind: 'rejected' }>) {
      if (pending?.request.sequence !== receipt.sequence) return;
      pending = null;
      localSelection = null;
    },
    select(value: PresenceSelection | null) {
      validateSelection(value);
      localSelection = structuredClone(value);
    },
    presence(): Presence | null {
      if (pending) return null;

      return {
        generation,
        version: commits.length,
        sequence: ++presenceSequence,
        selection: structuredClone(localSelection),
      };
    },
    receivePresence(snapshot: PresenceSnapshot) {
      if (
        snapshot.generation !== generation ||
        snapshot.recipient !== session ||
        snapshot.sequence <= (presenceSnapshot?.sequence ?? 0)
      )
        return false;
      presenceSnapshot = structuredClone(snapshot);
      receivedPresenceAt = options.now();

      return true;
    },
    remoteSelections() {
      if (!presenceSnapshot || options.now() - receivedPresenceAt >= options.presenceLifetime)
        return [];

      return presenceSnapshot.peers.flatMap((peer) => {
        if (
          peer.generation !== generation ||
          peer.session === session ||
          peer.version > commits.length
        )
          return [];
        let selection = peer.selection;

        for (const commit of commits.slice(peer.version))
          selection = mapSelection(selection, commit.edit);

        if (pending?.edit) selection = mapSelection(selection, pending.edit);
        selection = documentCoordinates(schema, nodes()).normalizeSelection(selection);

        return selection ? [{ session: peer.session, selection: structuredClone(selection) }] : [];
      });
    },
    destroy() {
      confirmed.destroy();
      buffered.clear();
      presenceSnapshot = null;
      pending = null;
    },
  };
}
