import CanvasKitInit from 'canvaskit-wasm';
import { expect, test } from 'vitest';

import { checkInline } from '../owned-inline-checks';
import { createOwnedEngine } from '../owned-layout';

test('inline layout preserves atom geometry and retained snapshots with real shaping', async () => {
  const kit = await CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' });
  const owned = await createOwnedEngine(kit, 'shaping');
  expect(checkInline(owned).assertions).toBeGreaterThan(0);
});
