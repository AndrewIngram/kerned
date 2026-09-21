import { useCallback, useEffect, useMemo, useState } from 'react';

import { useEditorState } from '../../editor-react';
import { type EditorSample } from '../../editor-samples';
import { commentDecorations, createCommentStore } from '../../extensions/comment';
import { type StarterNode } from '../../extensions/demo-model';
import type { EditorSession } from '../../extensions/starter-kit/types';
import { type CommentHighlight } from '../../extensions/text-block-view';
import { type SelectionRange } from '../../model';
import { resolveRangeDecorations, type SelectionContext, type EditorState } from '../../state';

export function useComments(
  editor: EditorSession,
  editorState: EditorState<StarterNode>,
  sample: EditorSample,
  context: SelectionContext,
) {
  const [comments] = useState(() => createCommentStore<{ body: string; reply: string }>());

  const seedComments = useCallback(
    (nodes: readonly StarterNode[]) => {
      comments.putAll(
        (sample.comments?.(nodes) ?? []).map((seed) => ({
          id: seed.id,
          messages: [{ body: seed.body, reply: '' }],
          range: editor.positions.range(
            editor.positions.at(seed.nodeId, seed.from, 1),
            editor.positions.at(seed.nodeId, seed.to, -1),
          ),
        })),
      );
    },
    [comments, editor, sample],
  );

  useEffect(() => {
    seedComments(sample.initial);
  }, [sample, seedComments]);
  const commentState = useEditorState(comments, (state) => state);

  const decorations = useMemo(() => {
    function projectedRanges(range: SelectionRange): SelectionRange[] {
      if (range.kind === 'text') return [range];
      const text = context.text(range.id);

      if (text !== null) return [{ kind: 'text', id: range.id, from: 0, to: text.length }];
      const children = context.children(range.id);

      return children.length
        ? [range, ...children.flatMap((child) => projectedRanges({ kind: 'node', id: child.id }))]
        : [range];
    }

    const result = resolveRangeDecorations(
      commentDecorations(commentState.threads),
      editor.positions,
    );

    return {
      ...result,
      resolved: result.resolved.map((decoration) => ({
        ...decoration,
        ranges: decoration.ranges.flatMap(projectedRanges),
      })),
    };
  }, [commentState, editor.positions, context]);

  const commentsByNode = useMemo(() => {
    const result = new Map<number, CommentHighlight[]>();
    const nodes = new Map<number, string[]>();

    for (const decoration of decorations.resolved)
      for (const range of decoration.ranges) {
        if (range.kind === 'node') {
          const list = nodes.get(range.id) ?? [];
          list.push(decoration.id);
          nodes.set(range.id, list);
          continue;
        }

        const list = result.get(range.id) ?? [];
        list.push({ id: decoration.id, from: range.from, to: range.to });
        result.set(range.id, list);
      }

    return { text: result, nodes };
  }, [decorations]);

  return {
    comments,
    commentState,
    decorations,
    commentsByNode: commentsByNode.text,
    nodeComments: commentsByNode.nodes,
    seedComments,
  };
}
