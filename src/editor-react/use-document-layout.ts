import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import {
  createDocumentLayout,
  type DocumentLayoutFrame,
  type DocumentLayoutSource,
} from '../editor-canvas/document-layout';
import type { PresentBlock } from '../editor-canvas/scene';
import type { NodeIdentity } from '../model';

/** React supplies committed inputs and subscribes to the controller's immutable scene. */
export function useDocumentLayout<N extends NodeIdentity>({
  owned,
  present,
  source,
  ...frame
}: DocumentLayoutFrame<N> & {
  owned: Parameters<typeof createDocumentLayout>[0]['owned'];
  present: PresentBlock<N>;
  source: DocumentLayoutSource<N>;
}) {
  const controller = useMemo(
    () => createDocumentLayout({ owned, present, source }),
    [owned, present, source],
  );

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useLayoutEffect(() => controller.attach(), [controller]);
  useLayoutEffect(() => {
    controller.present(snapshot);
    controller.update(frame);
  });

  return {
    ...snapshot,
    onMeasure: controller.measure,
    layoutFor: controller.layoutFor,
    diagnostics: controller.diagnostics,
  };
}
