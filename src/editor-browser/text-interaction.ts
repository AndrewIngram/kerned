import {
  createTextNavigation,
  moveNodeSelection,
  textBoundaryNearNode,
  NodeSelection,
  RangeSelection,
  rangeSelection,
  type RangeEndpoint,
  selectionAnchor,
  extendSelection,
  endpointOffset,
  type NavigationNode,
  type SelectionContext,
  hitTestTextLines,
  textSelectionAtClick,
  TextSelection,
  type Selection,
  type TextHitRegion,
  type NavigationBlock,
  type NavigationLayout,
} from '../editor';
import type { PointerSelectionOptions } from './pointer-selection';

type TextInteractionOptions = {
  selection: Selection;
  context: SelectionContext;
  nodes: () => readonly NavigationNode[];
  nodeAt: (target: Element) => number | null;
  select: (selection: Selection) => void;
  breakHistory: () => void;
  focus: () => void;
  reveal: () => void;
  point: (x: number, y: number) => { x: number; y: number } | null;
  regions: () => Iterable<TextHitRegion>;
  text: (id: number) => string | null;
  blocks: () => readonly NavigationBlock[];
  layout: (id: number) => NavigationLayout;
  viewportHeight: number;
  onStart?: PointerSelectionOptions['onStart'];
  onDrag?: PointerSelectionOptions['onDrag'];
};

/** Stateful navigation and pointer policy shared by every renderer. Geometry and
 * schema text are supplied by the view; DOM controls retain their native input. */
export function createTextInteraction() {
  const navigation = createTextNavigation();

  return {
    bind(options: TextInteractionOptions) {
      const pointer: PointerSelectionOptions = {
        selection: () => options.selection,
        nodeAt: options.nodeAt,
        context: () => options.context,
        onSelect(next) {
          navigation.reset();
          options.select(next);
        },
        focus: options.focus,
        hitTest(clientX, clientY) {
          const point = options.point(clientX, clientY);

          return point ? hitTestTextLines(options.regions(), point.x, point.y) : null;
        },
        selectRange(hit, clicks) {
          const text = options.text(hit.point.id);

          return text === null
            ? null
            : textSelectionAtClick(text, hit.point.id, hit.point.offset, hit.upstream, clicks);
        },
        onStart: options.onStart,
        onDrag: options.onDrag,
      };

      return {
        pointer,
        keydown(this: void, event: KeyboardEvent) {
          if (!/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key))
            return false;

          const nodes = options.nodes();
          const structural = options.selection instanceof RangeSelection ? options.selection : null;

          const source = structural
            ? structural.head.kind === 'text'
              ? new TextSelection(structural.head)
              : new NodeSelection(structural.head.id)
            : options.selection;

          const nodeMove =
            source instanceof NodeSelection ? moveNodeSelection(source, event, nodes, null) : null;

          const seed =
            source instanceof TextSelection
              ? source
              : source instanceof NodeSelection && !nodeMove
                ? textBoundaryNearNode(source, nodes, /Left|Up|Home/.test(event.key), false)
                : null;

          const textMove = seed
            ? navigation.move({
                event,
                selection: seed,
                blocks: options.blocks(),
                layout: options.layout,
                viewportHeight: options.viewportHeight,
                platform: /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'other',
              })
            : null;

          let moved = nodeMove ?? moveNodeSelection(source, event, nodes, textMove) ?? textMove;

          if (source instanceof NodeSelection && event.shiftKey && textMove && !nodeMove) {
            moved = rangeSelection(
              structural?.anchor ?? {
                kind: 'node',
                id: source.id,
                side: /Left|Up|Home/.test(event.key) ? 'after' : 'before',
              },
              { kind: 'text', ...textMove.head },
              textMove.upstream,
            );
          }

          const mac = /Mac|iPhone|iPad/.test(navigator.platform);

          const documentEdge =
            (event.ctrlKey && (event.key === 'Home' || event.key === 'End')) ||
            (mac && event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown'));

          if (event.shiftKey && documentEdge) {
            const back = /Up|Home/.test(event.key),
              node = back ? nodes[0] : nodes.at(-1),
              anchor = selectionAnchor(options.selection);

            if (node && anchor)
              moved = extendSelection(
                anchor,
                node.text === null
                  ? { kind: 'node-selection', id: node.id }
                  : { kind: 'text', id: node.id, offset: back ? 0 : node.text.length },
                options.context,
              );
          }

          if (structural && moved) {
            const head: RangeEndpoint | null =
              moved instanceof TextSelection
                ? { kind: 'text', ...moved.head }
                : moved instanceof RangeSelection
                  ? moved.head
                  : moved instanceof NodeSelection
                    ? {
                        kind: 'node',
                        id: moved.id,
                        side: /Left|Up|Home/.test(event.key) ? 'before' : 'after',
                      }
                    : null;

            if (event.shiftKey && head)
              moved = rangeSelection(
                structural.anchor,
                head,
                moved instanceof TextSelection && moved.upstream,
              );
          }

          if (
            structural &&
            event.key.startsWith('Arrow') &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const back = /Left|Up/.test(event.key),
              head = structural.head;

            const inward =
              head.kind === 'node' && (back ? head.side === 'after' : head.side === 'before');

            if (event.shiftKey && inward && head.kind === 'node')
              moved = rangeSelection(structural.anchor, {
                ...head,
                side: back ? 'before' : 'after',
              });
            else if (!event.shiftKey && !structural.isEmpty(options.context)) {
              const forward =
                endpointOffset(options.context, structural.anchor) <=
                endpointOffset(options.context, structural.head);

              const edge = back
                ? forward
                  ? structural.anchor
                  : structural.head
                : forward
                  ? structural.head
                  : structural.anchor;

              moved = rangeSelection(edge, edge);
            } else if (!event.shiftKey && inward) moved = new NodeSelection(head.id);
          }

          if (!moved) return false;
          event.preventDefault();
          options.breakHistory();
          options.reveal();
          options.select(moved);

          return true;
        },
      };
    },
  };
}

/** A focused offscreen textarea can make native typing scroll to the document
 * origin. Keep the capture beside the visible caret, even when it is clipped. */
export function positionTextInput(
  input: HTMLTextAreaElement,
  bounds: DOMRect,
  x: number,
  y: number,
) {
  input.style.left = `${Math.max(0, Math.min(window.innerWidth - 2, x))}px`;
  input.style.top = `${Math.max(0, Math.min(window.innerHeight - 2, Math.max(bounds.top, Math.min(bounds.bottom - 2, y))))}px`;
}
