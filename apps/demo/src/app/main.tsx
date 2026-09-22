import { createRoot } from 'react-dom/client';

import '../editor.css';
import { loadEditorSample } from '../editor-samples.js';
import { App } from './app.js';

const root = document.getElementById('root');

if (!root) throw new Error('Missing root');

let reactRoot: ReturnType<typeof createRoot> | undefined;

let disposed = false;

function dispose() {
  disposed = true;
  reactRoot?.unmount();
  reactRoot = undefined;
}

import.meta.hot?.dispose(dispose);

(async () => {
  root.textContent = 'Loading sample…';

  const sample = await loadEditorSample();

  if (disposed) return;
  reactRoot = createRoot(root);
  reactRoot.render(<App initial={sample} />);
})().catch((error) => {
  if (disposed) return;
  root.setAttribute('role', 'alert');
  root.textContent = String(error);
});
