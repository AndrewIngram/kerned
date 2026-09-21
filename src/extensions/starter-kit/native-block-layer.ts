import type { BrowserViewOptions } from '../../editor-browser';
import {
  createNodeViews,
  type NodeView,
  type TextHighlight,
} from '../../editor-browser/node-views';
import { createViewLayers } from '../../editor-browser/view-layers';
import type { RegisterCanvasPainter } from '../../editor-canvas/canvas-renderer';
import type { DocumentLayout, DocumentLayoutSnapshot } from '../../editor-canvas/document-layout';
import { createLayerDrawing } from '../../editor-canvas/layer-drawing';
import { createLayerGeometry } from '../../editor-canvas/layer-geometry';
import { createTextLabels } from '../../editor-canvas/text-labels';
import type { StarterNode, StarterLeaf } from '../demo-model';
import type { EditorDocument } from './browser-document';
import { createTextBlockView, type CommentHighlight } from './text-block-view';
import type { EditorSession, Owned } from './types';

export type BlockLayerFrame = {
  doc: EditorDocument;
  clipboard: Pick<NonNullable<BrowserViewOptions['input']>, 'copy' | 'cut' | 'paste'>;
  layout: DocumentLayoutSnapshot<StarterLeaf> & { onMeasure: DocumentLayout['measure'] };
  viewport: { width: number; zoom: number };
  nodeComments: ReadonlyMap<number, readonly string[]>;
  commentsByNode: ReadonlyMap<number, CommentHighlight[]>;
  highlights: ReadonlyMap<number, readonly TextHighlight[]>;
  notice: (message: string) => void;
  setFocusedWidget: (id: number | null) => void;
  onOpen: (kind: 'mention' | 'comment', nodeId: number, atomId: string, index: number) => void;
};

type MountedBlock = { element: HTMLDivElement } & (
  | { kind: 'native'; view: NodeView<StarterNode> }
  | { kind: 'text'; view: ReturnType<typeof createTextBlockView> }
);

const noComments: readonly CommentHighlight[] = [];

function nodeId(root: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element) || !root.contains(target)) return null;
  const value = target.closest('[data-editor-node]')?.getAttribute('data-editor-node');

  return value == null ? null : Number(value);
}

/** Owns culled block DOM and all built-in views. React and vanilla hosts share this layer. */
export function createBlockLayer(
  element: HTMLDivElement,
  {
    editor,
    owned,
    register,
  }: { editor: EditorSession; owned: Pick<Owned, 'layoutText'>; register: RegisterCanvasPainter },
) {
  const renderers = createNodeViews(editor, {
    clipboard(event) {
      if (event.type === 'copy') frame?.clipboard.copy?.(event);
      else if (event.type === 'cut') frame?.clipboard.cut?.(event);
      else if (event.type === 'paste') frame?.clipboard.paste?.(event);
    },
    notice: (message) => frame?.notice(message),
  });

  const labels = createTextLabels(owned);
  const mounted = new Map<number, MountedBlock>();
  let frame: BlockLayerFrame | undefined;

  const layers = createViewLayers(
    element,
    editor,
    createLayerDrawing(register, () => frame?.layout.inset ?? 0),
  );

  const layerGeometry = createLayerGeometry();
  let destroyed = false;
  let detach: (() => void) | undefined;
  element.classList.add('dom-layer');

  function focus(event: FocusEvent) {
    frame?.setFocusedWidget(nodeId(element, event.target));
  }

  function blur(event: FocusEvent) {
    if (nodeId(element, event.target) !== nodeId(element, event.relatedTarget))
      frame?.setFocusedWidget(nodeId(element, event.relatedTarget));
  }

  function pointer(event: PointerEvent) {
    if (
      !(event.target instanceof Element) ||
      event.target.closest('button,input,a,textarea,select,[data-editor-interactive]')
    )
      return;
    const id = nodeId(element, event.target);
    const comment = id === null ? undefined : frame?.nodeComments.get(id)?.[0];

    if (id !== null && comment) frame?.onOpen('comment', id, comment, 0);
  }

  element.addEventListener('focusin', focus);
  element.addEventListener('focusout', blur);
  element.addEventListener('pointerdown', pointer, true);

  function remove(id: number, block: MountedBlock) {
    block.view.destroy();
    block.element.remove();
    mounted.delete(id);
  }

  const view = {
    get isDestroyed() {
      return destroyed;
    },
    update(next: BlockLayerFrame) {
      if (destroyed) throw new Error('Block layer is destroyed');
      frame = next;
      const { doc, layout, viewport } = next;
      const { width, zoom } = viewport;
      const { visible, scene, contentWidth, onMeasure, inset } = layout;
      element.style.width = `${width / zoom}px`;
      element.style.height = `${scene.height}px`;
      element.style.transform = `scale(${zoom})`;
      const active = new Set(visible.map((p) => p.node.id));

      for (const [id, block] of mounted) if (!active.has(id)) remove(id, block);
      layers.update({
        tree: doc.tree,
        insets: doc.projection.decorations,
        blocks: visible.map((block) => ({ ...block, text: layerGeometry(block.layout) })),
        inset,
        width: contentWidth,
      });

      for (const [index, p] of visible.entries()) {
        const renderer = renderers.find(p.node);
        const kind = renderer ? 'native' : 'text';
        let block = mounted.get(p.node.id);

        if (block && block.kind !== kind) {
          remove(p.node.id, block);
          block = undefined;
        }

        if (!block) {
          const host = element.ownerDocument.createElement('div');
          element.append(host);

          if (renderer) {
            const content = element.ownerDocument.createElement('div');
            host.append(content);
            block = { kind: 'native', element: host, view: renderer.mount(content) };
          } else
            block = {
              kind: 'text',
              element: host,
              view: createTextBlockView(host, register, labels),
            };
          mounted.set(p.node.id, block);
        }

        if (element.children[index] !== block.element) {
          const focused = element.ownerDocument.activeElement;
          const restore = focused instanceof HTMLElement && block.element.contains(focused);
          element.insertBefore(block.element, element.children[index] ?? null);

          if (restore && element.ownerDocument.activeElement !== focused)
            focused.focus({ preventScroll: true });
        }

        if (block.kind === 'text' && (p.node.kind === 'paragraph' || p.node.kind === 'heading')) {
          block.view.update({
            placement: { ...p, node: p.node },
            inset,
            comments: next.commentsByNode.get(p.node.id) ?? noComments,
            open: (annotation, id, offset) => frame?.onOpen(annotation, p.node.id, id, offset),
          });
        } else {
          block.element.classList.add('block-position');
          block.element.dataset.editorNode = String(p.node.id);
          block.element.dataset.selected = String(!!doc.selectedRange(p.node));
          block.element.dataset.commented = String(!!next.nodeComments.get(p.node.id)?.length);
          block.element.style.left = `${inset}px`;
          block.element.style.top = `${p.y}px`;
          block.element.style.width = `${contentWidth}px`;

          if (block.kind === 'native')
            block.view.update({
              node: p.node,
              width: contentWidth,
              onMeasure,
              highlights: next.highlights,
              selection: doc.editorState.selection,
              context: doc.context,
            });
        }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach?.();
      frame = undefined;
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', blur);
      element.removeEventListener('pointerdown', pointer, true);

      for (const [id, block] of mounted) remove(id, block);
      layers.destroy();
      element.replaceChildren();
      element.classList.remove('dom-layer');
      element.style.removeProperty('width');
      element.style.removeProperty('height');
      element.style.removeProperty('transform');
    },
  };

  detach = editor.on('destroy', () => view.destroy());

  return view;
}
