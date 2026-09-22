import { indexTree } from '@gprose/model';
import { selectionContext } from '@gprose/state';

import { schema } from './editor-foundation.js';

export async function mountCanvasInputProbe(element, initial) {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');

  const { useCanvasInput, useEditorViewport, useEditorState } = await import('@gprose/react');

  let current,
    props = { editor: initial, page: false, inset: 12 };

  const changes = [];

  function Probe({ editor, page, inset }) {
    const scroller = React.useRef(null),
      inputRef = React.useRef(null),
      canvasRef = React.useRef(null);

    const state = useEditorState(editor, (state) => state);
    const tree = React.useMemo(() => indexTree(schema, state.nodes), [state.nodes]);

    const context = React.useMemo(
      () => selectionContext(schema, state.nodes, tree),
      [state.nodes, tree],
    );

    const viewport = useEditorViewport(scroller, page);

    const input = useCanvasInput({
      schema,
      editor,
      context,
      inset,
      selection: state.selection,
      nodes: context.order(),
      node: (id) => tree.byId.get(id)?.node,
      canvasRef,
      inputRef,
      placements: [],
      layout: () => {
        throw new Error('No layout needed for input capture');
      },
      caret: [5, 1, 6, 12],
      activeTop: 0,
      viewport,
      afterSelectAll() {},
    });

    React.useLayoutEffect(() => {
      current = { ...input, viewport };
    });

    return React.createElement(
      'div',
      { ref: scroller, style: { height: 100, width: 300, overflow: 'auto' } },
      React.createElement('canvas', { ref: canvasRef, width: 300, height: 100 }),
      React.createElement('textarea', {
        ref: inputRef,
        style: { position: 'fixed' },
        onInput: (event) =>
          input.textInput.read(event.currentTarget, (...change) => changes.push(change)),
      }),
      React.createElement('div', { style: { height: 1000 } }),
    );
  }

  const root = createRoot(element);

  function render() {
    flushSync(() =>
      root.render(React.createElement(React.StrictMode, null, React.createElement(Probe, props))),
    );
  }

  render();

  return {
    get current() {
      return current;
    },
    changes,
    update(next) {
      props = { ...props, ...next };
      render();
    },
    unmount() {
      flushSync(() => root.unmount());
    },
  };
}
