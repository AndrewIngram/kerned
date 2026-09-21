import { type CanvasKit } from 'canvaskit-wasm';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadHybridSample, sampleUrl, type HybridSample } from '../../hybrid-samples';

import type { Owned } from '../../extensions/starter-kit/types';
import { EditorWorkspace } from './editor-workspace';

export function App({
  kit,
  owned,
  initial,
}: {
  kit: CanvasKit;
  owned: Owned;
  initial: HybridSample;
}) {
  const [sample, setSample] = useState<HybridSample | null>(initial);

  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');

  const request = useRef(0);

  async function switchSample(url: URL, push: boolean) {
    const id = ++request.current;
    setLoading(true);
    setError('');

    try {
      const next = await loadHybridSample(url);

      if (id !== request.current) return;
      // Dispose old scene snapshots and streaming work before the new scene uses
      // the shared engine. Keep WASM, fonts, and imported sample data resident.
      flushSync(() => setSample(null));

      if (push) history.pushState(null, '', url);
      window.scrollTo(0, 0);
      setSample(next);
    } catch (error) {
      if (id === request.current)
        setError(error instanceof Error ? error.message : 'Could not load sample');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    const back = () => {
      void switchSample(new URL(location.href), false);
    };

    window.addEventListener('popstate', back);

    return () => {
      request.current++;
      window.removeEventListener('popstate', back);
    };
  }, []);

  return (
    <>
      {sample && (
        <EditorWorkspace
          kit={kit}
          owned={owned}
          sample={sample}
          loading={loading}
          onSampleChange={(id) => {
            void switchSample(new URL(sampleUrl(id)), true);
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
