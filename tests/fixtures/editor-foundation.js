import { createSchema, createEditor, textSelection } from '../../src/editor/index.ts';

// Deliberately independent of the demo schema, text fields and renderer.
const text = (id, value, role = 'body') => ({ id, key: `n-${id}`, kind: 'text', role, value });

const group = (id, role, children = []) => ({ id, key: `n-${id}`, kind: 'group', role, children });

export const schema = createSchema([
  {
    name: 'writing',
    version: 1,
    kind: 'text',
    accepts: (n) => n.kind === 'text',
    validateUpdate() {},
    editing: {
      text: (n) => n.value,
      replace: (n, from, to, value) => ({
        ...n,
        value: n.value.slice(0, from) + value + n.value.slice(to),
      }),
      split: (n, at, identity) => [
        { ...n, value: n.value.slice(0, at) },
        { ...n, ...identity, value: n.value.slice(at) },
      ],
      join: (left, right) => ({ ...left, value: left.value + right.value }),
    },
  },
  {
    name: 'structure',
    version: 1,
    kind: 'container',
    accepts: (n) => n.kind === 'group',
    validateUpdate() {},
    content: {
      children: (n) => n.children,
      withChildren: (n, children) => ({ ...n, children }),
      validateChildren() {},
    },
  },
  {
    name: 'object',
    version: 1,
    kind: 'atom',
    accepts: (n) => n.kind === 'atom',
    validateUpdate() {},
  },
]);

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

  const { useEditorState, Editor, createReactRenderers } =
    await import('../../src/editor-react/index.tsx');

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
    return React.createElement(
      Editor,
      { view: props },
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
