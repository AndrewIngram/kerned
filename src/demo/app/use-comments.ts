import { type EditorState } from '@gprose/state';
import { useCallback, useEffect, useMemo } from 'react';

import { useEditorState } from '../../editor-react';
import { type EditorSample } from '../../editor-samples';
import { type createCommentStore } from '../../extensions/comment';
import { createCommentProjection } from '../../extensions/comment-projection';
import { type StarterNode } from '../../extensions/demo-model';
import type { EditorSession } from '../../extensions/starter-kit/types';

export function useComments(
  editor: EditorSession,
  editorState: EditorState<StarterNode>,
  sample: EditorSample,
  comments: ReturnType<typeof createCommentStore<{ body: string; reply: string }>>,
) {
  const project = useMemo(() => createCommentProjection(editor, comments), [editor, comments]);

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

  const projection = useMemo(
    () => project(editorState.nodes, commentState.threads),
    [project, editorState.nodes, commentState.threads],
  );

  return {
    comments,
    commentState,
    decorations: projection.decorations,
    seedComments,
  };
}
