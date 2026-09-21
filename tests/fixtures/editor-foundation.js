import { z } from 'zod';

import { createSchema, defineNode } from '../../src/model/index.ts';
import { createEditor, textSelection } from '../../src/state/index.ts';

// Deliberately independent of the demo schema, text fields and renderer.
const text = (id, value, role = 'body') => ({ id, key: `n-${id}`, kind: 'text', role, value });

const group = (id, role, children = []) => ({ id, key: `n-${id}`, kind: 'group', role, children });

export const schema = createSchema({
  extensions: [
    defineNode({
      name: 'text',
      version: 1,
      options: {},
      schema: () => ({
        attributes: z.strictObject({ value: z.string(), role: z.string().optional() }),
        content: { kind: 'text', field: 'value' },
      }),
    }),
    defineNode({
      name: 'group',
      version: 1,
      options: {},
      schema: () => ({
        attributes: z.strictObject({ role: z.string().optional() }),
        content: { kind: 'container', field: 'children' },
      }),
    }),
    defineNode({
      name: 'atom',
      version: 1,
      options: {},
      schema: () => ({ attributes: z.strictObject({}), content: { kind: 'atom' } }),
    }),
  ],
});

export function fixture(options = {}) {
  return createEditor(
    schema,
    [
      group(1, 'list', [
        group(2, 'item', [text(3, 'Alpha 😀 beta', 'heading'), text(4, 'Second')]),
      ]),
      group(5, 'table', [
        group(6, 'row', [group(7, 'cell', [text(8, 'A')]), group(9, 'cell', [text(10, 'B')])]),
        group(11, 'row', [group(12, 'cell', [text(13, 'C')]), group(14, 'cell', [text(15, 'D')])]),
      ]),
      group(16, 'empty'),
      { id: 17, key: 'n-17', kind: 'atom' },
    ],
    textSelection(3, 0),
    [],
    options,
  );
}

export function dispatch(editor, steps) {
  return editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: 'separate',
    time: editor.state.revision,
    steps,
  });
}

export function capture(editor, id, from, to, endId = id, startBias = 1, endBias = -1) {
  return editor.positions.range(
    editor.positions.at(id, from, startBias),
    editor.positions.at(endId, to, endBias),
  );
}

export async function mountStateProbe(editor, element) {
  const { createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const { useEditorState } = await import('../../src/editor-react/index.tsx');

  function Probe() {
    const value = useEditorState(editor, (state) => `${state.revision}:${state.selection.type}`);

    return createElement('span', null, value);
  }

  const root = createRoot(element);
  flushSync(() => root.render(createElement(Probe)));

  return { flush: (action) => flushSync(action), unmount: () => root.unmount() };
}

export async function mountOptimizedProbe(editor, element) {
  const React = await import('react'),
    { createRoot } = await import('react-dom/client'),
    { flushSync } = await import('react-dom');

  const { useEditorState, createReactRenderers } = await import('../../src/editor-react/index.tsx');

  const { mountEditorView } = await import('../../src/editor-browser/index.ts');

  const counts = { revision: 0, selection: 0, pointer: 0, input: 0, renderer: 0 };
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

  const View = createReactRenderers([
    {
      name: 'custom',
      component: ({ value }) => {
        const [n, setN] = React.useState(0);
        counts.renderer++;

        return React.createElement('button', { onClick: () => setN(n + 1) }, `${value}:${n}`);
      },
    },
  ]);

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
      React.createElement(View, { type: 'custom', value: 'node' }),
    );
  }

  const root = createRoot(element);
  flushSync(() =>
    root.render(React.createElement(React.StrictMode, null, React.createElement(Probe))),
  );

  return { counts, flush: flushSync, unmount: () => flushSync(() => root.unmount()) };
}
