export async function mountOptimizedProbe(editor, element) {
  const React = await import('react'),
    { createRoot } = await import('react-dom/client'),
    { flushSync } = await import('react-dom');

  const { useEditorState } = await import('@kerned/react');

  const { mountEditorView } = await import('../native-view.js');

  const counts = { revision: 0, selection: 0, pointer: 0, input: 0 };
  const selectRevision = (state) => state.revision;
  const selectSelection = (state) => ({ kind: state.selection.type });

  function Revision() {
    // oxlint-disable-next-line react/immutability -- This probe counts render attempts, including discarded StrictMode renders.
    counts.revision++;

    return React.createElement('output', null, useEditorState(editor, selectRevision));
  }

  function Selection() {
    // oxlint-disable-next-line react/immutability -- Counting render attempts verifies selector suppression, not commit counts.
    counts.selection++;
    useEditorState(editor, selectSelection, (a, b) => a.kind === b.kind);

    return null;
  }

  function View({ value }) {
    const [n, setN] = React.useState(0);

    return React.createElement('button', { onClick: () => setN(n + 1) }, `${value}:${n}`);
  }

  const props = {
    pointer: {
      hitTest: () => ({ point: { id: 3, offset: 0 }, upstream: false }),
      selection: () => editor.state.selection,
      onSelect: () => {
        counts.pointer++;
      },
      focus: () => {},
    },
    input: {
      element: () => element.querySelector('textarea'),
      input: () => {
        counts.input++;
      },
    },
  };

  function Probe() {
    const host = React.useRef(null);
    React.useLayoutEffect(() => {
      const mounted = mountEditorView(host.current, props);

      return () => mounted.destroy();
    }, []);

    return React.createElement(
      'div',
      { ref: host },
      React.createElement(Revision),
      React.createElement(Selection),
      React.createElement('textarea'),
      React.createElement(View, { value: 'node' }),
    );
  }

  const root = createRoot(element);
  flushSync(() =>
    root.render(React.createElement(React.StrictMode, null, React.createElement(Probe))),
  );

  return { counts, flush: flushSync, unmount: () => flushSync(() => root.unmount()) };
}
