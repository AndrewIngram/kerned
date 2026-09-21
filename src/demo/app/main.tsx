import CanvasKitInit from 'canvaskit-wasm';
import { createRoot } from 'react-dom/client';
import { loadHybridSample } from '../../hybrid-samples';
import '../../hybrid.css';
import { createOwnedEngine } from '../../owned-layout';

import { App } from './app';

const root = document.getElementById('root');

if (!root) throw new Error('Missing root');

(async () => {
  root.textContent = 'Loading sample…';

  const [kit, sample] = await Promise.all([
    CanvasKitInit({ locateFile: () => '/engines/canvaskit.wasm' }),
    loadHybridSample(),
  ]);

  const owned = await createOwnedEngine(kit, 'shaping');
  createRoot(root).render(<App kit={kit} owned={owned} initial={sample} />);
})().catch((error) => {
  root.setAttribute('role', 'alert');
  root.textContent = String(error);
});
