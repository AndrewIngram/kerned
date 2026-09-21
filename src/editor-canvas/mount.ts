import './mount.css';
import { connectEditorView } from '../core';
import { mountEditorView, createEditorViewport, type BrowserViewOptions } from '../editor-browser';
import { createCanvasInput } from '../editor-browser/canvas-input';
import {
  inputPolicies,
  type ViewSession,
  type InputContribution,
} from '../editor-browser/input-contributions';
import { createNodeViews, type NodeView } from '../editor-browser/node-views';
import { createViewLayers } from '../editor-browser/view-layers';
import type { NodeIdentity } from '../model';
import { RangeSelection } from '../state';
import type { ResolveEditorAsset } from './assets';
import { createCanvasRenderer } from './canvas-renderer';
import { createDiagnosticSource } from './diagnostic-source';
import type { ViewDiagnostics } from './diagnostics';
import { createDocumentLayout } from './document-layout';
import { createLayerDrawing } from './layer-drawing';
import { createLayerGeometry } from './layer-geometry';
import { createDocumentPresentation } from './presentation';
import { createViewResources } from './resources';
import { createTextLabels } from './text-labels';
import { connectViewDiagnostics } from './view-diagnostics';
import { createViewGeometry } from './view-geometry';
import { readViewConfiguration, type ViewConfiguration } from './view-options';

export type MountEditorOptions<N extends NodeIdentity> = ViewConfiguration & {
  editor: ViewSession<N>;
  resolveAsset?: ResolveEditorAsset;
  scroll?: 'container' | 'page';
  toolbar?: HTMLElement;
  onError?: (error: Error) => void;
  onNotice?: (message: string) => void;
  diagnostics?: ViewDiagnostics;
};

/** The view owns its DOM and resources. Its session can be detached and mounted again. */
export function mountEditor<N extends NodeIdentity>(
  element: HTMLElement,
  options: MountEditorOptions<N>,
) {
  const { editor } = options;

  let configuration = readViewConfiguration({
    zoom: options.zoom,
    paddingTop: options.paddingTop,
    maxWidth: options.maxWidth,
    background: options.background,
  });

  const presentation = createDocumentPresentation(editor);
  // Resolve the initial projection before allocating native resources or changing the host.
  presentation.query(editor.state);
  const policies: ReturnType<InputContribution['create']>[] = [];

  function clipboard(event: ClipboardEvent) {
    for (const policy of policies) {
      if (event.type === 'copy') policy.copy?.(event);
      else if (event.type === 'cut') policy.cut?.(event);
      else if (event.type === 'paste') policy.paste?.(event);

      if (event.defaultPrevented) break;
    }
  }

  const viewport = createEditorViewport();
  viewport.setZoom(configuration.zoom);
  const capture = createCanvasInput({ schema: editor.schema, editor });
  const painter = createCanvasRenderer<N>({ onError: fail });
  const document = element.ownerDocument;
  const root = document.createElement('div');
  const space = document.createElement('div');
  const canvas = document.createElement('canvas');
  const overlay = document.createElement('div');
  const nativeNodes = document.createElement('div');
  nativeNodes.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  overlay.append(nativeNodes);
  const input = document.createElement('textarea');
  const notice = document.createElement('div');
  notice.setAttribute('role', 'status');
  notice.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
  const page = options.scroll === 'page';
  root.dataset.editorView = '';
  space.dataset.editorContent = '';
  input.dataset.editorInput = '';
  root.style.cssText = `position:relative;overflow-anchor:none;overscroll-behavior:contain;touch-action:none;cursor:text;width:100%;height:100%;min-height:240px;${page ? '' : 'overflow:auto;'}`;
  space.style.cssText = 'position:relative;margin-inline:auto;';
  space.style.maxWidth = configuration.maxWidth === null ? '' : `${configuration.maxWidth}px`;
  root.style.background = configuration.background;
  canvas.style.cssText = 'display:block;position:sticky;pointer-events:none;user-select:none;';
  canvas.setAttribute('aria-label', 'Canvas document');
  overlay.style.cssText =
    'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;';
  input.style.cssText =
    'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;padding:0;border:0;';
  input.setAttribute('aria-label', 'Editor text input');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.tabIndex = -1;
  space.append(canvas, overlay);
  root.append(space, input, notice);

  let status: 'loading' | 'ready' | 'failed' | 'destroyed' = 'loading';
  const cleanup: (() => void)[] = [];
  let failure: Error | undefined;
  let focusPending = false;
  let focused = false;
  let focusedNode: number | undefined;
  let layout: ReturnType<typeof createDocumentLayout<N>> | undefined;
  let diagnostics: ReturnType<typeof connectViewDiagnostics> | undefined;
  const blocks = new Map<number, { host: HTMLDivElement; view: NodeView<N>; name: string }>();
  let layers: ReturnType<typeof createViewLayers<N>> | undefined;
  const layerGeometry = createLayerGeometry();

  const renderers = createNodeViews(editor, { clipboard, notice: reportNotice, onError: fail });

  const geometry = createViewGeometry({
    editor,
    bounds: () => canvas.getBoundingClientRect(),
    nodeView: (id) => blocks.get(id)?.view,
    invalidate: updateLayout,
    onError: fail,
  });

  cleanup.push(() => geometry.destroy());

  function reportNotice(message: string) {
    notice.textContent = message;
    options.onNotice?.(message);
  }

  function dispose() {
    const errors: unknown[] = [];

    for (const release of cleanup.splice(0).toReversed()) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length) throw new AggregateError(errors, 'Editor view cleanup failed');
  }

  function fail(error: Error) {
    if (status === 'destroyed' || status === 'failed') return;
    status = 'failed';
    failure = error;

    try {
      dispose();
    } catch (cleanupError) {
      failure = new AggregateError([error, cleanupError], 'Editor view failed during cleanup');
    }

    options.onError?.(failure);
  }

  function destroy() {
    if (status === 'destroyed') return;
    status = 'destroyed';
    dispose();
  }

  function focus() {
    if (status === 'destroyed' || status === 'failed') return;
    focusPending = true;

    if (status !== 'ready' || !geometry.isCurrent()) return;
    const doc = presentation.query(editor.state);
    const owner = doc.focusId === null ? undefined : doc.blockFor(doc.focusId);

    if (owner && presentation.present(owner).kind === 'box') {
      const view = blocks.get(owner.id)?.view;

      if (!view) return;

      if (view.focusSelection) {
        focusPending = false;
        focusPending = !view.focusSelection(editor.state.selection);

        return;
      }
    }

    input.focus({ preventScroll: true });
    focusPending = false;
  }

  function readScroll() {
    if (!page) return viewport.readScroll();
    const origin = space.getBoundingClientRect().top + window.scrollY;

    return Math.max(0, window.scrollY - origin + viewport.getSnapshot().inset);
  }

  function scrollDocumentTo(top: number) {
    const origin = page
      ? space.getBoundingClientRect().top + window.scrollY - viewport.getSnapshot().inset
      : 0;

    viewport.scrollTo(top + origin);
  }

  function frameViewport() {
    const value = viewport.getSnapshot();

    return {
      width: value.width,
      zoom: value.zoom,
      viewportHeight: value.height,
      readScroll,
      scrollDocumentTo,
    };
  }

  function updateLayout() {
    layout?.update({
      viewport: frameViewport(),
      pinned: [...geometry.pinned(), ...(focusedNode === undefined ? [] : [focusedNode])],
      paddingTop: configuration.paddingTop,
      eager: diagnostics?.options.composition === 'eager',
      retainAll: diagnostics?.options.retention === 'all',
      onLayout(result, width) {
        if (!diagnostics?.observed) return;
        diagnostics.emit(
          Object.freeze({
            type: 'layout',
            at: performance.now(),
            revision: editor.state.revision,
            generation: result.scene.generation,
            pending: result.scene.pending,
            blocks: result.scene.placements.length,
            width,
            duration: result.workMs,
            compositionMs: result.compositionMs,
            layoutIds: Object.freeze([...result.layoutIds]),
            reflow: result.reflow,
            background: result.background,
          }),
        );
      },
    });
  }

  function update(value: ViewConfiguration) {
    if (status === 'destroyed' || status === 'failed') throw new Error(`Editor view is ${status}`);
    const next = readViewConfiguration(value, configuration);

    if (
      next.zoom === configuration.zoom &&
      next.paddingTop === configuration.paddingTop &&
      next.maxWidth === configuration.maxWidth &&
      next.background === configuration.background
    )
      return;
    const repaint = next.background !== configuration.background;
    configuration = next;
    space.style.maxWidth = next.maxWidth === null ? '' : `${next.maxWidth}px`;
    root.style.background = next.background;

    try {
      viewport.setZoom(next.zoom);
      updateLayout();

      if (repaint) publish();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  function backgroundColor(): [number, number, number] {
    const color = resources.read().kit.parseColorString(configuration.background);

    return [color[0] * 255, color[1] * 255, color[2] * 255];
  }

  function publish() {
    if (!layout || status === 'destroyed' || status === 'failed') return;
    const snapshot = layout.getSnapshot();
    const doc = presentation.query(editor.state);

    if (snapshot.nodes !== doc.nodes) return;
    const port = frameViewport();
    const { scene, visible, contentWidth, inset } = snapshot;
    space.style.height = `${Math.max(scene.height * port.zoom, port.viewportHeight)}px`;
    canvas.style.width = `${port.width}px`;
    canvas.style.height = `${port.viewportHeight}px`;
    canvas.style.top = `${page ? viewport.getSnapshot().inset : 0}px`;
    overlay.style.width = `${port.width / port.zoom}px`;
    overlay.style.height = `${scene.height}px`;
    overlay.style.transform = `scale(${port.zoom})`;
    const active = new Set(visible.map((p) => p.node.id));

    for (const [id, block] of blocks) {
      if (active.has(id)) continue;
      block.view.destroy();
      block.host.remove();
      blocks.delete(id);
    }

    let nativeIndex = 0;

    for (const placement of visible) {
      const renderer = renderers.find(placement.node);
      const id = placement.node.id;
      let block = blocks.get(id);

      if (block && block.name !== renderer?.name) {
        block.view.destroy();
        block.host.remove();
        blocks.delete(id);
        block = undefined;
      }

      if (!renderer) {
        if (presentation.present(placement.node).kind === 'box')
          throw new Error(`Missing node view for ${editor.schema.resolve(placement.node).name}`);
        continue;
      }

      if (!block) {
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;pointer-events:auto;';
        host.dataset.editorNode = String(id);
        nativeNodes.append(host);
        const content = document.createElement('div');
        host.append(content);
        block = { host, view: renderer.mount(content), name: renderer.name };
        blocks.set(id, block);
      }

      if (nativeNodes.children[nativeIndex] !== block.host) {
        const activeElement = document.activeElement;
        const restore = activeElement instanceof HTMLElement && block.host.contains(activeElement);
        nativeNodes.insertBefore(block.host, nativeNodes.children[nativeIndex] ?? null);

        if (restore && document.activeElement !== activeElement)
          activeElement.focus({ preventScroll: true });
      }

      nativeIndex++;
      block.host.style.left = `${inset}px`;
      block.host.style.top = `${placement.y}px`;
      block.host.style.width = `${contentWidth}px`;
      block.host.dataset.selected = String(!!doc.selectedRange(placement.node));
      block.view.update({
        node: placement.node,
        width: contentWidth,
        onMeasure: layout.measure,
        selection: editor.state.selection,
        context: doc.context,
      });
    }

    layout.present(snapshot);
    layers?.update({
      tree: doc.tree,
      insets: doc.projection.decorations,
      blocks: visible.map(layerGeometry),
      inset,
      width: contentWidth,
    });
    geometry.update({ document: doc, layout: snapshot, viewport: port });
    capture.update({
      context: doc.context,
      inset,
      selection: doc.selection,
      nodes: doc.nodes,
      node: (id) => doc.tree.byId.get(id)?.node,
      placements: scene.placements,
      layout: layout.layoutFor,
      caret: snapshot.caret,
      activeTop: snapshot.activePlacement?.y,
      viewport: port,
    });
    painter.update({
      inset,
      width: port.width,
      height: port.viewportHeight,
      zoom: port.zoom,
      top: snapshot.top,
      background: backgroundColor(),
      blocks: visible,
      selectedRange: doc.selectedRange,
      caret: snapshot.caret,
      caretTop: snapshot.activePlacement?.y ?? 0,
      focused,
      onPaint(report) {
        if (!diagnostics?.observed) return;
        diagnostics.emit(
          Object.freeze({
            ...report,
            type: 'paint',
            revision: doc.editorState.revision,
            generation: scene.generation,
            pending: scene.pending,
            blocks: scene.placements.length,
            width: contentWidth,
            mounted: blocks.size,
            stale: visible.some(
              (placement) =>
                presentation.present(placement.node).kind === 'text' &&
                (!placement.layout || placement.layoutWidth !== scene.width),
            ),
          }),
        );
      },
    });

    if (focusPending) focus();
  }

  // Own the session attachment during loading too, so destroy and duplicate mounts are deterministic.
  cleanup.push(
    connectEditorView(editor, {
      focus,
      reveal() {
        const doc = presentation.query(editor.state);
        const head = doc.selection instanceof RangeSelection ? doc.selection.head : null;
        const range = doc.ranges[0];

        const point =
          doc.textSelection?.head ??
          (head?.kind === 'text'
            ? head
            : range?.kind === 'text'
              ? { id: range.id, offset: range.to }
              : null);

        if (point) void geometry.reveal(point);
        else capture.revealSelection();
      },
      destroy,
    }),
  );
  let resources: ReturnType<typeof createViewResources>;

  try {
    if (options.diagnostics) {
      diagnostics = connectViewDiagnostics(
        options.diagnostics,
        createDiagnosticSource(() => {
          const snapshot = geometry.getSnapshot();

          if (status !== 'ready' || !layout || !snapshot) return null;

          return {
            revision: snapshot.documentRevision,
            layout: layout.diagnostics,
            engine: resources.read().layout,
            mounted: blocks.keys(),
            painterCount: painter.diagnostics.painterCount,
          };
        }),
      );
      const lease = diagnostics;
      cleanup.push(() => lease.destroy());
    }

    element.append(root);
    cleanup.push(() => root.remove());
    resources = createViewResources({ resolveAsset: options.resolveAsset });
    cleanup.push(() => resources.destroy());
    cleanup.push(
      () => viewport.destroy(),
      () => painter.destroy(),
      () => capture.destroy(),
    );
  } catch (error) {
    destroy();
    throw error;
  }

  async function initialize() {
    try {
      await resources.ready;

      if (status === 'destroyed') throw new DOMException('Editor view was destroyed', 'AbortError');
      const native = resources.read();
      layers = createViewLayers(
        overlay,
        editor,
        createLayerDrawing(
          painter.register,
          () => layout?.getSnapshot().inset ?? 0,
          createTextLabels(native.layout),
        ),
        { onError: fail, onTextPointer: capture.onTextPointer },
      );
      const installedLayers = layers;
      cleanup.push(() => installedLayers.destroy());

      layout = createDocumentLayout({
        owned: native.layout,
        onError: fail,
        present: (node) => presentation.present(node),
        source: {
          getSnapshot: () => presentation.query(editor.state),
          subscribe: editor.subscribe,
        },
      });
      const controller = layout;
      cleanup.push(() => controller.destroy());
      cleanup.push(() => {
        const errors: unknown[] = [];

        for (const block of blocks.values()) {
          try {
            block.view.destroy();
          } catch (error) {
            errors.push(error);
          }
        }

        blocks.clear();

        if (errors.length) throw new AggregateError(errors, 'Node view cleanup failed');
      });

      for (const policy of inputPolicies.read(editor)) {
        const installed = policy.create({
          editor,
          input,
          textInput: capture.textInput,
          selectAll: capture.selectAll,
          navigate: capture.navigate,
          notice: reportNotice,
        });

        policies.push(installed);

        if (installed.destroy) cleanup.push(() => installed.destroy?.());
      }

      if (policies.filter((policy) => policy.input).length > 1)
        throw new Error('A mounted editor requires a single text input policy');
      input.readOnly = !policies.some((policy) => policy.input);

      let focusUpdate = false;

      const trackFocus = (event: FocusEvent) => {
        const target = event.type === 'focusout' ? event.relatedTarget : event.target;

        const host =
          target instanceof Element && overlay.contains(target)
            ? target.closest('[data-editor-node]')
            : null;

        focusedNode = host ? Number(host.getAttribute('data-editor-node')) : undefined;

        // Moving/replacing a native control can dispatch blur during DOM reconciliation.
        // Publish its retention change after that operation has completed.
        if (focusUpdate) return;
        focusUpdate = true;
        queueMicrotask(() => {
          focusUpdate = false;

          if (status !== 'ready') return;

          try {
            updateLayout();
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
      };

      overlay.addEventListener('focusin', trackFocus);
      overlay.addEventListener('focusout', trackFocus);
      cleanup.push(() => {
        overlay.removeEventListener('focusin', trackFocus);
        overlay.removeEventListener('focusout', trackFocus);
      });

      const events: NonNullable<BrowserViewOptions['input']> = {
        element: () => input,
        keydown(event) {
          if (event.isComposing || capture.textInput.composing) return;

          for (const policy of policies) {
            policy.keydown?.(event);

            if (event.defaultPrevented) return;
          }

          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            capture.selectAll();
          } else capture.navigate(event);
        },
        compositionstart: capture.textInput.compositionStart,
        compositionend: () => capture.textInput.compositionEnd(input),
        input(event, value) {
          for (const policy of policies) policy.input?.(event, value);
        },
        copy: clipboard,
        cut: clipboard,
        paste: clipboard,
        focus(value) {
          focused = value;
          publish();
        },
      };

      const eventsView = mountEditorView(root, {
        pointer: capture.pointerSelection,
        input: events,
      });

      cleanup.push(() => eventsView.destroy());
      capture.attach(canvas, input);
      painter.attach(native.kit, canvas);
      viewport.attach({
        element: space,
        scrollport: page ? window : root,
        toolbar: options.toolbar,
      });
      cleanup.push(
        viewport.subscribe(() => {
          try {
            updateLayout();
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        }),
        layout.subscribe(publish),
      );
      layout.attach();
      updateLayout();
      status = 'ready';

      if (focusPending) focus();
    } catch (error) {
      if (status !== 'destroyed') fail(error instanceof Error ? error : new Error(String(error)));

      throw error;
    }
  }

  const ready = initialize();
  void ready.catch(() => {});

  return {
    ready,
    get status() {
      return status;
    },
    get error() {
      return failure;
    },
    get isDestroyed() {
      return status === 'destroyed';
    },
    focus,
    update,
    scrollTo(top: number) {
      if (status === 'destroyed' || status === 'failed')
        throw new Error(`Editor view is ${status}`);

      if (!Number.isFinite(top)) throw new RangeError('Scroll position must be finite');
      scrollDocumentTo(Math.max(0, top) * configuration.zoom);
    },
    getSnapshot: geometry.getSnapshot,
    subscribe: geometry.subscribe,
    blockBounds: geometry.blockBounds,
    /** Client coordinates for resident canvas or native text; null until layout is current. */
    coordsAt: geometry.coordsAt,
    reveal: geometry.reveal,
    destroy,
  };
}

export type MountedEditor = ReturnType<typeof mountEditor>;
