import { indexTree, validateTextRange, type NodeIdentity, type Schema } from '@gprose/model';
import { applySteps, type Step } from '@gprose/transform';

import { documentCoordinates } from '../coordinates.js';
import { rebase, sameEdit, type Edit } from '../protocol.js';
import type { Body, ProjectedProposal, WriteReceipt } from './wire.js';

type Basis = { epoch: number; revision: number; texts: Map<string, string> };

/** Own canonical edits and the private mapping from sent views to revisions.
 * No canonical revision, rejected text or mapped edit leaves this module. */
export function createProjectedDocument<N extends NodeIdentity>(options: {
  schema: Schema<N>;
  nodes: readonly N[];
  epoch: () => number;
  changed: (structural: boolean) => void;
}) {
  const { schema } = options;
  let nodes = options.nodes;
  let edits: Edit[] = [];

  function apply(steps: readonly Step<N>[]) {
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
    else edits.push(...changes);
    options.changed(structural);
  }

  return {
    get nodes() {
      return nodes;
    },
    apply,
    writer(session: string, canEdit: (key: string) => boolean) {
      const views = new Map<number, Basis>();
      const receipts = new Map<number, { proposal: ProjectedProposal; receipt: WriteReceipt }>();

      return {
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
              edit = rebase(edit, subsequent);

              if (!edit) return reject('conflict');
            }

            const step = documentCoordinates(schema, nodes).edit(edit);

            if (!step) return reject('precondition');
            apply([step]);

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
