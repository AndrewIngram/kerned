import type { TextSelection } from '@gprose/state';
import { useLayoutEffect, useRef, useState } from 'react';

import {
  createPointerSelection,
  type PointerSelectionOptions,
} from '../editor-browser/pointer-selection';

export function usePointerSelection(
  options: Omit<PointerSelectionOptions, 'selection'> & { selection: TextSelection },
) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);

  // oxlint-disable-next-line react/refs -- The controller stores event callbacks; it does not read their refs during construction.
  const [controller] = useState(() =>
    createPointerSelection({
      selection: () => latest.current.selection,
      hitTest: (x, y) => latest.current.hitTest(x, y),
      onSelect: (value) => latest.current.onSelect(value),
      focus: () => latest.current.focus(),
      selectRange: (hit, clicks) => latest.current.selectRange?.(hit, clicks) ?? null,
      onStart: (hit, clicks) => latest.current.onStart?.(hit, clicks),
      onDrag: (hit) => latest.current.onDrag?.(hit),
    }),
  );

  return controller;
}
