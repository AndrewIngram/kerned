import { createOutlineExtension, type OutlineEntry } from '@gprose/extension-outline';
import type { MountedEditor, ViewSnapshot } from '@gprose/view';
import { useMemo, useState } from 'react';

import { type EditorSample } from '../../editor-samples';
import { plainText } from '../demo-model.js';
import { demoSchema } from '../demo-schema.js';
import type { EditorDocument } from '../document-query.js';

type OutlineOptions = Pick<EditorDocument, 'editorState'> & {
  sample: EditorSample;
  loadedCount: number;
  view: MountedEditor | null;
  geometry: ViewSnapshot | null;
};

export function useOutline({ sample, loadedCount, editorState, view, geometry }: OutlineOptions) {
  const pendingOutline = useMemo(
    () =>
      sample.outline?.filter((item) => item.sourceIndex >= loadedCount).map((item) => item.entry) ??
      [],
    [sample, loadedCount],
  );

  const [outlineExtension] = useState(() =>
    createOutlineExtension(demoSchema, (node) =>
      node.kind === 'heading' ? { level: node.level, title: plainText(node) } : null,
    ),
  );

  const outline = useMemo(
    () => outlineExtension.read(editorState.nodes, pendingOutline),
    [outlineExtension, editorState.nodes, pendingOutline],
  );

  const outlinePositions = useMemo(
    () =>
      !geometry
        ? []
        : outline.flatMap((entry) => {
            const bounds = view?.blockBounds(entry.id);

            return bounds ? [{ entry, y: bounds.top }] : [];
            // A layout or viewport publication invalidates the view's geometry queries.
            // oxlint-disable-next-line react/exhaustive-effect-dependencies
          }),
    [outline, view, geometry],
  );

  const outlineAvailable = useMemo(
    () => new Set(outlinePositions.map((item) => item.entry.key)),
    [outlinePositions],
  );

  let outlineActive: string | null = outlinePositions[0]?.entry.key ?? null;

  for (const item of outlinePositions) {
    if (item.y > (geometry?.viewport.top ?? 0) + 40 / (geometry?.zoom ?? 1)) break;
    outlineActive = item.entry.key;
  }

  function navigateOutline(entry: OutlineEntry) {
    if (!outlineAvailable.has(entry.key)) return;
    void view?.reveal({ id: entry.id, offset: 0 }, { align: 'start', margin: 24 });
  }

  return { outline, outlineAvailable, outlineActive, navigateOutline };
}
