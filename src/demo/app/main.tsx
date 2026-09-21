import { createRoot } from 'react-dom/client';

import { createViewResources } from '../../editor-canvas/resources';

import '../../editor.css';
import { loadEditorSample } from '../../editor-samples';
import { App } from './app';

const root = document.getElementById('root');

if (!root) throw new Error('Missing root');

const resources = createViewResources();

let reactRoot: ReturnType<typeof createRoot> | undefined;

let disposed = false;

function dispose() {
  disposed = true;
  reactRoot?.unmount();
  reactRoot = undefined;
  resources.destroy();
}

import.meta.hot?.dispose(dispose);

(async () => {
  root.textContent = 'Loading sample…';

  const [, sample] = await Promise.all([resources.ready, loadEditorSample()]);

  if (disposed) return;
  const { kit, layout } = resources.read();
  reactRoot = createRoot(root);
  reactRoot.render(<App kit={kit} owned={layout} initial={sample} />);
})().catch((error) => {
  if (disposed) return;
  resources.destroy();
  root.setAttribute('role', 'alert');
  root.textContent = String(error);
});
