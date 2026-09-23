import { createCommentStore } from '@kerned/extension-comments';
import { commentView } from '@kerned/extension-comments/browser';
import { searchView } from '@kerned/extension-search';
import { createSchema } from '@kerned/model';
import { useEditor } from '@kerned/react';
import { starterBrowserExtensions } from '@kerned/starter-kit/browser';
import { textSelection } from '@kerned/state';
import { useMemo, useState } from 'react';

import type { EditorSample } from '../editor-samples.js';
import { streamConfig } from '../editor-stream.js';
import { EditorWorkspaceView } from './editor-workspace-view.js';

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
