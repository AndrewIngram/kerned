import type { PrepareText } from '../browser/drawing.js';
import type { LaidOut } from '../internal/engines.js';
import type { createOwnedEngine } from '../internal/owned-layout.js';
import { fontSelectionSchema } from './font-catalog.js';

type TextLabel = Parameters<PrepareText>[0];

/** View-owned labels survive viewport eviction without reserving document node IDs.
 * Snapshots borrow the engine's fonts; dropping a cached label owns no native cleanup.
 */
export function createTextLabels(
  engine: Pick<Awaited<ReturnType<typeof createOwnedEngine>>, 'layoutText'>,
) {
  const snapshots = new Map<string, LaidOut>();

  return (input: TextLabel) => {
    const font = input.font === undefined ? undefined : fontSelectionSchema.parse(input.font);

    const family = font?.family?.toLowerCase() ?? '';
    const key = `${family.length}:${family}/${font?.weight ?? 400}/${font?.style ?? 'normal'}/${input.size}/${input.width}/${input.text}`;

    const existing = snapshots.get(key);

    if (existing) {
      snapshots.delete(key);
      snapshots.set(key, existing);

      return existing;
    }

    const layout = engine.layoutText({ ...input, font, spans: [] });
    snapshots.set(key, layout);
    const oldest = snapshots.keys().next();

    if (snapshots.size > 128 && !oldest.done) snapshots.delete(oldest.value);

    return layout;
  };
}

export type TextLabels = ReturnType<typeof createTextLabels>;
