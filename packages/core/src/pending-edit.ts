import type {
  DocumentRange,
  NodeIdentity,
  RelativePosition,
  SchemaDefinition,
  SelectionRange,
} from '@gprose/model';
import {
  TextSelection,
  type CommandContext,
  type CommandOptions,
  type DocumentRangeResult,
  type Selection,
} from '@gprose/state';

import type { Editor } from './session.js';

/** Serializable coordinates only. This value does not retain a document snapshot. */
export type PendingEditTarget =
  | Readonly<{ kind: 'point'; position: RelativePosition }>
  | Readonly<{ kind: 'range'; range: DocumentRange }>;

export type PendingEditResult =
  | { status: 'applied' | 'rejected' | 'cancelled' | 'settled' }
  | Exclude<DocumentRangeResult, { status: 'resolved' }>;

export type PendingEdit<N extends NodeIdentity> = {
  readonly target: PendingEditTarget;
  readonly signal: AbortSignal;
  cancel(): void;
  /** Runs once in a fresh transaction; normal step permission checks still apply. */
  commit(
    command: (context: CommandContext<N>, ranges: readonly SelectionRange[]) => boolean,
    options?: CommandOptions,
  ): PendingEditResult;
};

type Host<N extends NodeIdentity> = Pick<
  Editor<readonly SchemaDefinition[], N>,
  'state' | 'positions' | 'transact' | 'on' | 'isDestroyed'
>;

/** Capture a caret or contiguous selection before starting asynchronous work.
 * Unsupported selections, such as a rectangle of cells, return null.
 * Call cancel when the request is superseded; session destruction cancels it too.
 */
export function createPendingEdit<N extends NodeIdentity>(
  editor: Host<N>,
  selection: Selection = editor.state.selection,
): PendingEdit<N> | null {
  if (editor.isDestroyed) throw new Error('Editor is destroyed');
  let target: PendingEditTarget;

  if (
    selection instanceof TextSelection &&
    selection.anchor.id === selection.head.id &&
    selection.anchor.offset === selection.head.offset
  ) {
    target = Object.freeze({
      kind: 'point',
      position: editor.positions.at(selection.head.id, selection.head.offset),
    });
  } else {
    const range = editor.positions.captureRange(selection);

    if (!range) return null;
    target = Object.freeze({ kind: 'range', range });
  }

  const controller = new AbortController();
  let status: 'pending' | 'cancelled' | 'settled' = 'pending';
  const detach = editor.on('destroy', cancel);

  function cancel() {
    if (status !== 'pending') return;
    status = 'cancelled';
    detach();
    controller.abort();
  }

  function resolve(): DocumentRangeResult {
    if (target.kind === 'range') return editor.positions.resolveDocumentRange(target.range);
    const result = editor.positions.resolve(target.position);

    if (result.status !== 'resolved') return result;

    return {
      status: 'resolved',
      ranges: [
        { kind: 'text', id: result.point.id, from: result.point.offset, to: result.point.offset },
      ],
    };
  }

  return {
    target,
    signal: controller.signal,
    cancel,
    commit(command, options = {}) {
      if (status !== 'pending') return { status };
      status = 'settled';
      detach();
      const resolved = resolve();

      if (resolved.status !== 'resolved') return resolved;

      const applied = editor.transact((context) => command(context, resolved.ranges), {
        history: 'separate',
        ...options,
      });

      return { status: applied ? 'applied' : 'rejected' };
    },
  };
}
