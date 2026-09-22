import { useCallback, useEffect, useRef, useState } from 'react';

import { loadEditorSample, sampleUrl, type EditorSample } from '../editor-samples.js';
import { EditorWorkspace } from './editor-workspace.js';

export function App({ initial }: { initial: EditorSample }) {
  const [current, setCurrent] = useState({ sample: initial, generation: 0 });

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

      if (push) history.pushState(null, '', url);
      window.scrollTo(0, 0);
      setCurrent({ sample: next, generation: id });
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
      <EditorWorkspace
        key={current.generation}
        sample={current.sample}
        loading={loading}
        onSampleChange={changeSample}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
