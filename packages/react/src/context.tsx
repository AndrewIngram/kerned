import type { Editor } from '@gprose/core';
import type { NodeIdentity, SchemaDefinition } from '@gprose/model';
import { createContext, useContext, type ReactNode } from 'react';

/** Preserve the assembled schema's commands and node types throughout a React subtree. */
export function createEditorContext<
  const D extends readonly SchemaDefinition[],
  N extends NodeIdentity,
>(schema: Editor<D, N>['schema']) {
  const Context = createContext<Editor<D, N> | null | undefined>(undefined);

  function EditorProvider({
    editor,
    children,
  }: {
    editor: Editor<D, N> | null;
    children: ReactNode;
  }) {
    if (editor && editor.schema !== schema)
      throw new Error('EditorProvider requires an editor created with its bound schema');

    return <Context.Provider value={editor}>{children}</Context.Provider>;
  }

  function useCurrentEditor() {
    const editor = useContext(Context);

    if (editor === undefined) throw new Error('useCurrentEditor requires its EditorProvider');

    return editor;
  }

  return { EditorProvider, useCurrentEditor };
}
