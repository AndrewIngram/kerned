import type { Rect } from '../engines';
import type { NodeIdentity, Schema } from '../model';
import {
  TextSelection,
  NodeSelection,
  RangeSelection,
  AllSelection,
  type Selection,
  type EditorState,
  type SelectionContext,
} from '../state';
import type { TextHitRegion } from './hit-testing';
import type { NavigationLayout } from './keyboard-navigation';
import type { PointerSelectionOptions } from './pointer-selection';
import { createTextInput } from './text-input';
import { createTextInteraction, positionTextInput } from './text-interaction';

export type CanvasInputSession<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  breakHistory(this: void): void;
  select(this: void, selection: Selection): void;
};

export type CanvasInputFrame<N extends NodeIdentity> = {
  context: SelectionContext;
  inset: number;
  selection: Selection;
  nodes: readonly N[];
  node: (id: number) => N | undefined;
  placements: readonly {
    node: N;
    y: number;
    height: number;
    layout: (NavigationLayout & Pick<TextHitRegion, 'lines' | 'hit'>) | null;
  }[];
  layout: (id: number) => NavigationLayout;
  caret: Rect | undefined;
  activeTop: number | undefined;
  viewport: {
    zoom: number;
    viewportHeight: number;
    readScroll: () => number;
    scrollDocumentTo: (top: number) => void;
  };
  afterSelectAll?: () => void;
  onStart?: PointerSelectionOptions['onStart'];
  onDrag?: PointerSelectionOptions['onDrag'];
};

/** Native input synchronization and geometry binding, shared by vanilla and React views. */
export function createCanvasInput<N extends NodeIdentity>({
  schema,
  editor,
}: {
  schema: Schema<N>;
  editor: CanvasInputSession<N>;
}) {
  let frame: CanvasInputFrame<N> | undefined;

  let attachment:
    | { input: HTMLTextAreaElement; canvas: HTMLCanvasElement; detach: () => void }
    | undefined;

  let destroyed = false;
  let revealPending = false;
  let scheduled = 0;
  let synced: { node: N | undefined; selection: Selection } | undefined;

  function assertActive() {
    if (destroyed) throw new Error('Canvas input is destroyed');
  }

  function currentFrame() {
    assertActive();

    if (!frame) throw new Error('Canvas input requires a layout frame');

    return frame;
  }

  const textInput = createTextInput(schema, editor, () => currentFrame().context);
  const textInteraction = createTextInteraction();

  function cancelReveal() {
    cancelAnimationFrame(scheduled);
    scheduled = 0;
    revealPending = false;
  }

  function revealSelection() {
    assertActive();
    revealPending = true;

    if (!scheduled && attachment)
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        reveal();
      });
  }

  function selectAll() {
    const { nodes, afterSelectAll } = currentFrame();

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
      afterSelectAll?.();
      attachment?.input?.focus({ preventScroll: true });

      return;
    }

    editor.select(
      new TextSelection(
        { id: first.id, offset: 0 },
        { id: last.id, offset: schema.text(last)!.length },
      ),
    );
    afterSelectAll?.();
    attachment?.input?.focus({ preventScroll: true });
  }

  const interaction = textInteraction.bind({
    get selection() {
      return currentFrame().selection;
    },
    get context() {
      return currentFrame().context;
    },
    nodes: () =>
      currentFrame().nodes.map((node) => ({
        id: node.id,
        text: schema.text(node),
        selectable: currentFrame().context.selectable(node.id),
      })),
    nodeAt(target) {
      const surface = target.closest('[data-editor-node]');
      const id = Number(surface?.getAttribute('data-editor-node'));

      return surface && Number.isSafeInteger(id) && currentFrame().context.selectable(id)
        ? id
        : null;
    },
    select: editor.select,
    breakHistory: editor.breakHistory,
    focus: () => attachment?.input?.focus({ preventScroll: true }),
    reveal: revealSelection,
    point(clientX, clientY) {
      const canvas = attachment?.canvas;

      const {
        viewport: { zoom, readScroll },
        inset,
      } = currentFrame();

      if (!canvas) return null;
      const bounds = canvas.getBoundingClientRect();

      return {
        x: (clientX - bounds.left) / zoom - inset,
        y: (clientY - bounds.top + readScroll()) / zoom,
      };
    },
    *regions() {
      for (const p of currentFrame().placements)
        if (p.layout) yield { id: p.node.id, top: p.y, lines: p.layout.lines, hit: p.layout.hit };
    },
    text(id) {
      const node = currentFrame().node(id);

      return node ? schema.text(node) : null;
    },
    blocks: () =>
      currentFrame().placements.flatMap((p) => {
        const text = schema.text(p.node);

        return text === null ? [] : [{ id: p.node.id, text, top: p.y, height: p.height }];
      }),
    layout: (id) => currentFrame().layout(id),
    get viewportHeight() {
      const { viewport } = currentFrame();

      return viewport.viewportHeight / viewport.zoom;
    },
    onStart: (hit, clicks) => currentFrame().onStart?.(hit, clicks),
    onDrag: (hit) => currentFrame().onDrag?.(hit),
  });

  function reveal() {
    if (!attachment || !frame || !revealPending || frame.selection !== editor.state.selection)
      return;
    const { selection, placements, caret, activeTop, viewport } = frame;
    const { zoom, viewportHeight, readScroll, scrollDocumentTo } = viewport;

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
    revealPending = false;

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
    }
  }

  function synchronize() {
    if (!attachment || !frame) return;
    const { input, canvas } = attachment;
    const { selection, caret, activeTop, inset, viewport } = frame;
    const { zoom, readScroll } = viewport;
    const bounds = canvas.getBoundingClientRect();
    const x = bounds.left + ((caret?.[0] ?? 0) + inset) * zoom;

    const y =
      bounds.top +
      (activeTop === undefined ? 0 : activeTop * zoom - readScroll()) +
      (caret?.[1] ?? 0) * zoom;

    positionTextInput(input, bounds, x, y);
    const node = selection instanceof TextSelection ? frame.node(selection.head.id) : undefined;

    if (!textInput.composing && (synced?.selection !== selection || synced.node !== node)) {
      textInput.sync(input);
      synced = { selection, node };
    }

    reveal();
  }

  function detach() {
    attachment?.detach();
    attachment = undefined;
    frame = undefined;
    synced = undefined;
    cancelReveal();
  }

  return {
    textInput,
    selectAll,
    revealSelection,
    pointerSelection: interaction.pointer,
    navigate: interaction.keydown,
    update(next: CanvasInputFrame<N>) {
      assertActive();
      frame = next;
      synchronize();
    },
    attach(canvas: HTMLCanvasElement, input: HTMLTextAreaElement) {
      assertActive();

      if (attachment) throw new Error('Canvas input is already attached');
      const target = { canvas, input, detach: textInput.mount(input, selectAll) };
      attachment = target;

      try {
        synchronize();
      } catch (error) {
        detach();
        throw error;
      }

      return () => {
        if (attachment === target) detach();
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach();
      textInput.destroy();
    },
  };
}
