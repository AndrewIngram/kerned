import { useMemo, useState } from 'react';

import { type EditorSample } from '../../editor-samples';
import { type Scene } from '../../editor-scene';
import { plainText } from '../../extensions/demo-model';
import { demoSchema } from '../../extensions/demo-schema';
import { createOutlineExtension, type OutlineEntry } from '../../extensions/outline';
import type { EditorDocument } from '../../extensions/starter-kit/document';

type OutlineOptions = Pick<EditorDocument, 'editorState' | 'tree'> & {
  sample: EditorSample;
  loadedCount: number;
  scene: Scene;
  zoom: number;
  scroll: number;
  toolbarHeight: number;
  scrollDocumentTo: (top: number) => void;
  readScroll: () => number;
  setScroll: (top: number) => void;
};

export function useOutline({
  sample,
  loadedCount,
  editorState,
  scene,
  tree,
  zoom,
  scroll,
  toolbarHeight,
  scrollDocumentTo,
  readScroll,
  setScroll,
}: OutlineOptions) {
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

  const outlinePositions = useMemo(() => {
    const placements = new Map(scene.placements.map((p) => [p.node.id, p]));

    return outline.flatMap((entry) => {
      let node = tree.byId.get(entry.id);

      while (node && !placements.has(node.node.id))
        node = node.parent === null ? undefined : tree.byId.get(node.parent);
      const placement = node ? placements.get(node.node.id) : undefined;

      return placement ? [{ entry, y: placement.y, placementId: placement.node.id }] : [];
    });
  }, [outline, scene.placements, tree]);

  const outlineAvailable = useMemo(
    () => new Set(outlinePositions.map((item) => item.entry.key)),
    [outlinePositions],
  );

  let outlineActive: string | null = outlinePositions[0]?.entry.key ?? null;

  for (const item of outlinePositions) {
    if (item.y * zoom > scroll + 40) break;
    outlineActive = item.entry.key;
  }

  function navigateOutline(entry: OutlineEntry) {
    const target = outlinePositions.find((item) => item.entry.key === entry.key);

    if (!target) return;
    scrollDocumentTo(Math.max(0, target.y * zoom - 24));
    setScroll(readScroll());

    if (target.placementId !== entry.id)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const element = document.querySelector<HTMLElement>(`[data-text-block="${entry.id}"]`);

          if (element) {
            scrollDocumentTo(
              Math.max(0, readScroll() + element.getBoundingClientRect().top - toolbarHeight - 24),
            );
            setScroll(readScroll());
          }
        }),
      );
  }

  return { outline, outlineAvailable, outlineActive, navigateOutline };
}
