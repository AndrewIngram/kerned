import CanvasKitInit from 'canvaskit-wasm';
import { expect, test } from 'vitest';

import { checkInline } from '../owned-inline-checks.js';
import { createOwnedEngine } from '../owned-layout.js';

test('inline layout preserves atom geometry and retained snapshots with real shaping', async () => {
  const kit = await CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' });
  const owned = await createOwnedEngine(kit, 'shaping');

  try {
    expect(checkInline(owned).assertions).toBeGreaterThan(0);
  } finally {
    owned.destroy();
  }
});
