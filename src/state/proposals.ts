import { type RelativeRange, type NodeIdentity, type Schema, indexTree } from '../model';
import type { Step } from '../transform';
import type { RelativeRangeResult } from './relative-positions';

/** Preconditions travel with the request. No proposal/range registry is required. */
export type TextProposal = {
  range: RelativeRange;
  expected: readonly { key: string; text: string }[];
  replacement: string;
};

export type PreparedTextProposal<N extends NodeIdentity> =
  | { status: 'ready'; baseRevision: number; steps: readonly Step<N>[] }
  | { status: 'conflict'; reason: 'unresolved-range' | 'target-changed' };

export function prepareTextProposal<N extends NodeIdentity>(
  schema: Schema<N>,
  editor: {
    readonly state: { nodes: readonly N[]; revision: number };
    positions: { resolveRange(range: RelativeRange): RelativeRangeResult };
  },
  proposal: TextProposal,
): PreparedTextProposal<N> {
  const state = editor.state,
    result = editor.positions.resolveRange(proposal.range);

  if (result.status !== 'resolved') return { status: 'conflict', reason: 'unresolved-range' };
  const tree = indexTree(schema, state.nodes);

  if (
    result.ranges.length !== proposal.expected.length ||
    result.ranges.some((range, i) => {
      const node = tree.byId.get(range.id)?.node,
        expected = proposal.expected[i];

      return (
        !node ||
        node.key !== expected.key ||
        schema.text(node)?.slice(range.from, range.to) !== expected.text
      );
    })
  )
    return { status: 'conflict', reason: 'target-changed' };

  return {
    status: 'ready',
    baseRevision: state.revision,
    steps: [
      {
        kind: 'replaceRanges',
        ranges: result.ranges.map((range) => ({ kind: 'text', ...range })),
        text: proposal.replacement,
        pruneEmpty: [],
      },
    ],
  };
}
