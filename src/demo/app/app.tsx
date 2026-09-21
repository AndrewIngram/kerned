import { type CanvasKit } from 'canvaskit-wasm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { loadEditorSample, sampleUrl, type EditorSample } from '../../editor-samples';
import type { Owned } from '../../extensions/starter-kit/types';
import { EditorWorkspace } from './editor-workspace';

export function App({
  kit,
  owned,
  initial,
}: {
  kit: CanvasKit;
  owned: Owned;
  initial: EditorSample;
}) {
  const [sample, setSample] = useState<EditorSample | null>(initial);

  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');

  const request = useRef(0);

  const switchSample = useCallback(async (url: URL, push: boolean) => {
    const id = ++request.current;
    setLoading(true);
    setError('');

    try {
      const next = await loadEditorSample(url);

      if (id !== request.current) return;
      // Dispose old scene snapshots and streaming work before the new scene uses
      // the shared engine. Keep WASM, fonts, and imported sample data resident.
      flushSync(() => setSample(null));

      if (push) history.pushState(null, '', url);
      window.scrollTo(0, 0);
      setSample(next);
    } catch (errorValue) {
      if (id === request.current)
        setError(errorValue instanceof Error ? errorValue.message : 'Could not load sample');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const back = () => {
      void switchSample(new URL(location.href), false);
    };

    window.addEventListener('popstate', back);

    // This is a request counter, not a DOM ref; invalidate in-flight loads at cleanup.
    return () => {
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the live request counter on unmount.
      request.current++;
      window.removeEventListener('popstate', back);
    };
  }, [switchSample]);

  const changeSample = useCallback(
    (id: string) => {
      void switchSample(new URL(sampleUrl(id)), true);
    },
    [switchSample],
  );

  return (
    <>
      {sample && (
        <EditorWorkspace
          kit={kit}
          owned={owned}
          sample={sample}
          loading={loading}
          onSampleChange={changeSample}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
