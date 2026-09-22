import { indexTree, validateTextRange, type NodeIdentity, type Schema } from '@gprose/model';
import { applySteps, type Step } from '@gprose/transform';

import { documentCoordinates } from '../coordinates.js';
import { rebase, sameEdit, mapSelection, type PresenceSelection, type Edit } from '../protocol.js';
import type { Body, ProjectedProposal, WriteReceipt, Frame, ProjectedPresence } from './wire.js';

type Basis = { epoch: number; revision: number; texts: Map<string, string> };

/** Own canonical edits and the private mapping from sent views to revisions.
 * Only edits visible throughout a delivery interval may leave this module. */
export function createProjectedDocument<N extends NodeIdentity>(options: {
  schema: Schema<N>;
  nodes: readonly N[];
  epoch: () => number;
  changed: (structural: boolean, edits: readonly Edit[]) => void;
}) {
  const { schema } = options;
  let nodes = options.nodes;
  let edits: { edit: Edit; source: { session: string; operation: number } | null }[] = [];

  function apply(
    steps: readonly Step<N>[],
    source: { session: string; operation: number } | null = null,
  ) {
    let next = nodes;
    const changes: Edit[] = [];

    for (const step of steps) {
      if (step.kind === 'replaceText') {
        const node = indexTree(schema, next).byId.get(step.id)?.node;
        const before = node && schema.text(node);

        if (!node || before === undefined || before === null) throw new Error('Missing text node');
        changes.push({
          key: node.key,
          from: step.from,
          to: step.to,
          text: step.text,
          expected: before.slice(step.from, step.to),
        });
      }

      next = applySteps(schema, next, [step]).nodes;
    }

    const structural = steps.some((step) => step.kind !== 'replaceText');
    nodes = next;

    if (structural) edits = [];
    else edits.push(...changes.map((edit) => ({ edit, source })));
    options.changed(structural, changes);
  }

  return {
    get nodes() {
      return nodes;
    },
    apply(steps: readonly Step<N>[]) {
      apply(steps);
    },
    writer(session: string, canEdit: (key: string) => boolean) {
      const views = new Map<number, Basis>();

      const receipts = new Map<number, { proposal: ProjectedProposal; receipt: WriteReceipt }>();

      return {
        presence(
          packet: ProjectedPresence,
        ): { kind: 'rejected' } | { kind: 'accepted'; selection: PresenceSelection | null } {
          const basis = views.get(packet.base);

          if (
            packet.session !== session ||
            packet.epoch !== options.epoch() ||
            basis?.epoch !== packet.epoch
          )
            return { kind: 'rejected' };
          let selection = packet.selection;

          if (selection) {
            for (const point of [selection.anchor, selection.head]) {
              const text = basis.texts.get(point.key);

              if (text === undefined) return { kind: 'rejected' };

              try {
                validateTextRange(text, point.offset, point.offset);
              } catch {
                return { kind: 'rejected' };
              }
            }
          }

          for (const entry of edits.slice(basis.revision))
            selection = mapSelection(selection, entry.edit);
          selection = documentCoordinates(schema, nodes).normalizeSelection(selection);

          return { kind: 'accepted', selection };
        },
        delivery(
          base: number | null,
          epoch: number,
          bodies: ReadonlyMap<string, Body>,
        ): Frame['writes'] {
          const basis = base === null ? undefined : views.get(base);

          const changes =
            basis?.epoch === epoch
              ? edits
                  .slice(basis.revision)
                  .flatMap(({ edit, source }) =>
                    basis.texts.has(edit.key) && bodies.has(edit.key)
                      ? [{ edit, operation: source?.session === session ? source.operation : null }]
                      : [],
                  )
              : [];

          return structuredClone({
            changes,
            receipts: [...receipts.values()].map((value) => value.receipt),
          });
        },
        sent(sequence: number, epoch: number, bodies: ReadonlyMap<string, Body>) {
          views.set(sequence, {
            epoch,
            revision: edits.length,
            texts: new Map(
              [...bodies].flatMap(([key, body]) => (body.text === null ? [] : [[key, body.text]])),
            ),
          });
        },
        submit(proposal: ProjectedProposal): WriteReceipt {
          if (proposal.session !== session) return { kind: 'invalid' };
          const prior = receipts.get(proposal.operation);

          if (prior) {
            const before = prior.proposal;

            if (
              before.epoch !== proposal.epoch ||
              before.base !== proposal.base ||
              !sameEdit(before.edit, proposal.edit)
            )
              return { kind: 'rejected', operation: proposal.operation, reason: 'identity' };

            return structuredClone(prior.receipt);
          }

          function evaluate(): WriteReceipt {
            const reject = (
              reason: Extract<WriteReceipt, { kind: 'rejected' }>['reason'],
            ): WriteReceipt => ({ kind: 'rejected', operation: proposal.operation, reason });

            // Current authorization precedes any historical lookup or text checks.
            // Missing, protected and read-only targets deliberately look identical.
            if (!canEdit(proposal.edit.key)) return reject('denied');
            const basis = views.get(proposal.base);

            if (!basis || proposal.epoch !== options.epoch() || basis.epoch !== proposal.epoch)
              return reject('stale');
            const before = basis.texts.get(proposal.edit.key);

            if (
              before === undefined ||
              before.slice(proposal.edit.from, proposal.edit.to) !== proposal.edit.expected
            )
              return reject('precondition');

            try {
              validateTextRange(before, proposal.edit.from, proposal.edit.to);
            } catch {
              return reject('precondition');
            }

            let edit: Edit | null = proposal.edit;

            for (const subsequent of edits.slice(basis.revision)) {
              edit = rebase(edit, subsequent.edit);

              if (!edit) return reject('conflict');
            }

            const step = documentCoordinates(schema, nodes).edit(edit);

            if (!step) return reject('precondition');
            apply([step], { session, operation: proposal.operation });

            return { kind: 'accepted', operation: proposal.operation };
          }

          const receipt = evaluate();
          receipts.set(proposal.operation, {
            proposal: structuredClone(proposal),
            receipt: structuredClone(receipt),
          });

          return receipt;
        },
        close() {
          views.clear();
          receipts.clear();
        },
      };
    },
  };
}
