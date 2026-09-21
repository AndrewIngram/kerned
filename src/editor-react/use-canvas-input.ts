import { useCallback, useEffect, useLayoutEffect, useRef, useMemo, type RefObject } from 'react';

import {
  type NavigationLayout,
  type TextHitRegion,
  createTextInput,
  createTextInteraction,
  positionTextInput,
  type PointerSelectionOptions,
} from '../editor-browser';
import type { Rect } from '../engines';
import { type NodeIdentity, type Schema } from '../model';
import {
  TextSelection,
  NodeSelection,
  RangeSelection,
  AllSelection,
  type Selection,
  type createEditor,
  type SelectionContext,
} from '../state';
import type { Viewport } from './use-viewport';

type CanvasInputOptions<N extends NodeIdentity> = {
  context: SelectionContext;
  inset: number;
  schema: Schema<N>;
  editor: Pick<ReturnType<typeof createEditor<N>>, 'state' | 'breakHistory'> & {
    select(this: void, selection: Selection): void;
  };
  selection: Selection;
  nodes: readonly N[];
  node: (id: number) => N | undefined;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placements: readonly {
    node: N;
    y: number;
    height: number;
    layout: (NavigationLayout & Pick<TextHitRegion, 'lines' | 'hit'>) | null;
  }[];
  layout: (id: number) => NavigationLayout;
  caret: Rect | undefined;
  activeTop: number | undefined;
  viewport: Viewport;
  afterSelectAll: () => void;
  onStart?: PointerSelectionOptions['onStart'];
  onDrag?: PointerSelectionOptions['onDrag'];
};

/** React lifecycle for the framework-independent input controller. Neither the
 * document's schema names nor the layout engine are part of this adapter. */
export function useCanvasInput<N extends NodeIdentity>(options: CanvasInputOptions<N>) {
  const {
    inset,
    schema,
    editor,
    selection,
    canvasRef,
    inputRef,
    placements,
    layout,
    caret,
    activeTop,
    viewport,
  } = options;

  const { scroll, zoom, width, viewportHeight, readScroll, scrollDocumentTo, setScroll } = viewport;

  const revealCaret = useRef(false),
    latest = useRef(options);

  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);

  const textInput = useMemo(
    // oxlint-disable-next-line react/refs -- The factory captures the context getter for input events without invoking it during render.
    () => createTextInput(schema, editor, () => latest.current.context),
    [schema, editor],
  );

  const textInteraction = useMemo(() => createTextInteraction(), []);

  const selectAll = useCallback(() => {
    const { nodes, afterSelectAll } = latest.current;

    const textNodes = nodes.filter((node) => schema.text(node) !== null),
      first = textNodes[0],
      last = textNodes.at(-1);

    const start = nodes[0],
      end = nodes.at(-1);

    if (!start || !end) {
      editor.select(new AllSelection());

      return;
    }

    if (!first || !last || first.id !== start.id || last.id !== end.id) {
      editor.select(
        new RangeSelection(
          { kind: 'node', id: start.id, side: 'before' },
          { kind: 'node', id: end.id, side: 'after' },
        ),
      );
      afterSelectAll();
      inputRef.current?.focus({ preventScroll: true });

      return;
    }

    editor.select(
      new TextSelection(
        { id: first.id, offset: 0 },
        { id: last.id, offset: schema.text(last)!.length },
      ),
    );
    afterSelectAll();
    inputRef.current?.focus({ preventScroll: true });
  }, [editor, schema, inputRef]);

  // bind only captures these event callbacks; it never reads DOM refs during render.
  // oxlint-disable-next-line react/refs -- Binding captures DOM getters for later input events.
  const interaction = textInteraction.bind({
    selection,
    context: options.context,
    nodes: () =>
      options.nodes.map((node) => ({
        id: node.id,
        text: schema.text(node),
        selectable: options.context.selectable(node.id),
      })),
    nodeAt(target) {
      const surface = target.closest('[data-editor-node]');
      const id = Number(surface?.getAttribute('data-editor-node'));

      return surface && Number.isSafeInteger(id) && options.context.selectable(id) ? id : null;
    },
    select: editor.select,
    breakHistory: editor.breakHistory,
    focus: () => inputRef.current?.focus({ preventScroll: true }),
    reveal: () => {
      revealCaret.current = true;
    },
    point(clientX, clientY) {
      const canvas = canvasRef.current;

      if (!canvas) return null;
      const bounds = canvas.getBoundingClientRect();

      return {
        x: (clientX - bounds.left) / zoom - inset,
        y: (clientY - bounds.top + readScroll()) / zoom,
      };
    },
    *regions() {
      for (const p of placements)
        if (p.layout) yield { id: p.node.id, top: p.y, lines: p.layout.lines, hit: p.layout.hit };
    },
    text(id) {
      const node = options.node(id);

      return node ? schema.text(node) : null;
    },
    blocks: () =>
      placements.flatMap((p) => {
        const text = schema.text(p.node);

        return text === null ? [] : [{ id: p.node.id, text, top: p.y, height: p.height }];
      }),
    layout,
    viewportHeight: viewportHeight / zoom,
    onStart: options.onStart,
    onDrag: options.onDrag,
  });

  useLayoutEffect(() => {
    const input = inputRef.current,
      canvas = canvasRef.current;

    if (!input || !canvas) return;

    const bounds = canvas.getBoundingClientRect(),
      x = bounds.left + ((caret?.[0] ?? 0) + inset) * zoom;

    const y =
      bounds.top +
      (activeTop === undefined ? 0 : activeTop * zoom - readScroll()) +
      (caret?.[1] ?? 0) * zoom;

    positionTextInput(input, bounds, x, y);
  }, [
    caret,
    activeTop,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Viewport and selection changes invalidate imperative DOM measurements and input state.
    scroll,
    zoom,
    width,
    viewportHeight,
    inset,
    readScroll,
    inputRef,
    canvasRef,
  ]);
  const active = selection instanceof TextSelection ? options.node(selection.head.id) : undefined;
  useLayoutEffect(() => {
    if (!textInput.composing && inputRef.current) textInput.sync(inputRef.current);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Viewport and selection changes invalidate imperative DOM measurements and input state.
  }, [active, selection, textInput, inputRef]);
  useEffect(() => {
    const input = inputRef.current;

    if (input) return textInput.mount(input, selectAll);

    return undefined;
  }, [textInput, selectAll, inputRef]);
  useLayoutEffect(() => {
    if (!revealCaret.current) return;

    const node =
      selection instanceof NodeSelection
        ? placements.find((p) => p.node.id === selection.id)
        : selection instanceof RangeSelection && selection.head.kind === 'node'
          ? placements.find((p) => p.node.id === selection.head.id)
          : undefined;

    const bounds = node
      ? {
          top: node.y * zoom,
          bottom: node.y * zoom + Math.min(node.height * zoom, viewportHeight - 16),
        }
      : caret && activeTop !== undefined
        ? { top: (activeTop + caret[1]) * zoom, bottom: (activeTop + caret[3]) * zoom }
        : null;

    if (!bounds) return;
    revealCaret.current = false;

    const { top, bottom } = bounds,
      currentScroll = readScroll();

    const target =
      top < currentScroll + 8
        ? top - 8
        : bottom > currentScroll + viewportHeight - 8
          ? bottom - viewportHeight + 8
          : currentScroll;

    if (target !== currentScroll) {
      scrollDocumentTo(Math.max(0, target));
      setScroll(readScroll());
    }
  }, [
    selection,
    activeTop,
    caret,
    viewportHeight,
    zoom,
    placements,
    readScroll,
    scrollDocumentTo,
    setScroll,
  ]);

  return {
    textInput,
    selectAll,
    pointerSelection: interaction.pointer,
    navigate: interaction.keydown,
  };
}
