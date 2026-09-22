import type { NodeIdentity, Schema, SelectionRange } from '@gprose/model';
import { resolveRangeDecorations, selectionContext } from '@gprose/state';

import { commentDecorations, type CommentThread } from './comment.js';

export type CommentHighlight = Readonly<{ id: string; from: number; to: number }>;

export type CommentSource<Message = unknown> = {
  readonly state: { readonly threads: readonly CommentThread<Message>[] };
  subscribe(listener: () => void): () => void;
};

/** A comment source remains external; only its projection depends on this document snapshot. */
export function createCommentProjection<N extends NodeIdentity, Message>(
  editor: {
    readonly schema: Schema<N>;
    readonly state: { readonly nodes: readonly N[] };
    readonly positions: Parameters<typeof resolveRangeDecorations>[1];
  },
  source: CommentSource<Message>,
) {
  function project(roots: readonly N[], threads: readonly CommentThread<Message>[]) {
    const context = threads.length ? selectionContext(editor.schema, roots) : null;

    function projectedRanges(range: SelectionRange): SelectionRange[] {
      if (range.kind === 'text' || !context) return [range];
      const text = context.text(range.id);

      if (text !== null) return [{ kind: 'text', id: range.id, from: 0, to: text.length }];
      const children = context.children(range.id);

      return children.length
        ? [range, ...children.flatMap((child) => projectedRanges({ kind: 'node', id: child.id }))]
        : [range];
    }

    const result = resolveRangeDecorations(commentDecorations(threads), editor.positions);

    const decorations = {
      ...result,
      resolved: result.resolved.map((decoration) => ({
        ...decoration,
        ranges: decoration.ranges.flatMap(projectedRanges),
      })),
    };

    const text = new Map<number, CommentHighlight[]>();
    const nodes = new Map<number, string[]>();

    for (const decoration of decorations.resolved)
      for (const range of decoration.ranges) {
        if (range.kind === 'node') {
          const list = nodes.get(range.id) ?? [];
          list.push(decoration.id);
          nodes.set(range.id, list);
        } else {
          const list = text.get(range.id) ?? [];
          list.push({ id: decoration.id, from: range.from, to: range.to });
          text.set(range.id, list);
        }
      }

    return { context, decorations, text, nodes };
  }

  const empty = project([], []);

  let previous:
    | {
        nodes: readonly N[];
        threads: readonly CommentThread<Message>[];
        value: ReturnType<typeof project>;
      }
    | undefined;

  return (nodes = editor.state.nodes, threads = source.state.threads) => {
    if (!threads.length) return empty;

    if (!previous || previous.nodes !== nodes || previous.threads !== threads)
      previous = { nodes, threads, value: project(nodes, threads) };

    return previous.value;
  };
}
