import { useMemo, useState } from 'react';

import { useEditor } from '../../editor-react';
import type { EditorSample } from '../../editor-samples';
import { streamConfig } from '../../editor-stream';
import { createCommentStore } from '../../extensions/comment';
import { commentView } from '../../extensions/comment-view';
import { searchView } from '../../extensions/search-view';
import { starterBrowserExtensions } from '../../extensions/starter-kit/browser';
import { createSchema } from '../../model';
import { textSelection } from '../../state';
import { EditorWorkspaceView } from './editor-workspace-view';

export function EditorWorkspace(props: {
  sample: EditorSample;
  onSampleChange: (id: string) => void;
  loading: boolean;
}) {
  const minimal = location.pathname === '/editor.html';
  const [comments] = useState(() => createCommentStore<{ body: string; reply: string }>());

  const schema = useMemo(
    () =>
      createSchema({
        extensions: [
          commentView(comments),
          searchView,
          ...starterBrowserExtensions({
            imageDelay: streamConfig.imageDelay,
            bodySize: minimal ? 18 : 20,
          }),
        ],
      }),
    [comments, minimal],
  );

  const editor = useEditor({
    schema,
    document: props.sample.initial,
    selection: textSelection(1, 0),
  });

  if (!editor) return <main className="editor-shell" aria-busy="true" />;

  return (
    <EditorWorkspaceView
      {...props}
      key={editor.documentId}
      editor={editor}
      comments={comments}
      minimal={minimal}
    />
  );
}
