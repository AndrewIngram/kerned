import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import {
  createDocumentLayout,
  type DocumentLayoutFrame,
  type DocumentLayoutSource,
} from './document-layout';
import type { Owned } from './types';

/** React supplies committed inputs and subscribes to the controller's immutable scene. */
export function useDocumentLayout({
  owned,
  size,
  source,
  ...frame
}: DocumentLayoutFrame & { owned: Owned; size: number; source: DocumentLayoutSource }) {
  const controller = useMemo(
    () => createDocumentLayout({ owned, size, source }),
    [owned, size, source],
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
