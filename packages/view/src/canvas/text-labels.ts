import type { LaidOut, LayoutInput } from '../internal/engines.js';
import type { createOwnedEngine } from '../internal/owned-layout.js';

type TextLabel = Pick<LayoutInput, 'text' | 'width' | 'size'>;

/** View-owned labels survive viewport eviction without reserving document node IDs.
 * Snapshots borrow the engine's fonts; dropping a cached label owns no native cleanup.
 */
export function createTextLabels(
  engine: Pick<Awaited<ReturnType<typeof createOwnedEngine>>, 'layoutText'>,
) {
  const snapshots = new Map<string, LaidOut>();

  return (input: TextLabel) => {
    const key = `${input.size}/${input.width}/${input.text}`;
    const existing = snapshots.get(key);

    if (existing) {
      snapshots.delete(key);
      snapshots.set(key, existing);

      return existing;
    }

    const layout = engine.layoutText({ ...input, spans: [] });
    snapshots.set(key, layout);
    const oldest = snapshots.keys().next();

    if (snapshots.size > 128 && !oldest.done) snapshots.delete(oldest.value);

    return layout;
  };
}

export type TextLabels = ReturnType<typeof createTextLabels>;
