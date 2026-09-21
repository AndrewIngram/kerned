import { allocatedBlockWidth } from '../editor-browser/block-geometry';
import type { LaidOut, LayoutInput, Rect } from '../engines';
import type { NodeIdentity } from '../model';
import type { InlineAtom } from '../owned-inline';
import type { createOwnedEngine } from '../owned-layout';
import { createFlowLayout, type FlowLayoutEvent, type FlowPlacement } from './flow-layout';

type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

type BlockSpacing = { before: number; after: number; baselineGrid: number };

export type TextPresentation = BlockSpacing &
  Omit<LayoutInput, 'id' | 'width'> & {
    kind: 'text';
    color?: string;
    lineHeight: number;
    atoms: readonly InlineAtom[];
  };

export type BlockPresentation = TextPresentation | (BlockSpacing & { kind: 'box'; height: number });

/** Presentation values are immutable within each view configuration version. */
export type PresentBlock<N extends NodeIdentity> = (node: N) => BlockPresentation;

export type Placement<N extends NodeIdentity> = {
  node: N;
  y: number;
  height: number;
  layout: LaidOut | null;
  layoutWidth: number;
  boxes: {
    id: string;
    index: number;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
};

export type Scene<N extends NodeIdentity> = {
  placements: Placement<N>[];
  flows: ReadonlyMap<number, FlowPlacement<N>>;
  height: number;
  width: number;
  top: number;
  zoom: number;
  pending: number;
  generation: number;
  paddingTop: number;
};

export type Measurement = { width: number; height: number };

const emptyFlows: readonly never[] = [];

const emptyInsets: ReadonlyMap<number, { inset: number; endInset?: number }> = new Map();

type View = {
  top: number;
  height: number;
  zoom: number;
  pinned: readonly number[];
  advance: boolean;
  eager: boolean;
  retainAll: boolean;
  paddingTop?: number;
  presentationVersion?: number;
};

// Width is unknown until an inserted paragraph has been composed.
type Cached<N extends NodeIdentity> = {
  node: N;
  presentation: TextPresentation;
  width: number | null;
  height: number;
  layout: LaidOut | null;
  boxes: Placement<N>['boxes'];
};

export function createEditorScene<N extends NodeIdentity>(
  owned: Pick<Owned, 'createLayout'>,
  present: PresentBlock<N>,
) {
  let engine = owned;
  let fontsChanged = false;
  let textLayout: ReturnType<Owned['createLayout']> | undefined;

  const cache = new Map<number, Cached<N>>(),
    dirty = new Map<number, N>();

  let previous: Scene<N> = {
    placements: [],
    flows: new Map(),
    height: 50,
    width: 0,
    top: 0,
    zoom: 1,
    pending: 0,
    generation: 0,
    paddingTop: 0,
  };

  let currentDecorations = emptyInsets,
    previousDecorations = emptyInsets;

  let presentationVersion = 0;
  let previousFlows: readonly FlowLayoutEvent<N>[] | undefined;

  let previousNodes: readonly N[] = [],
    previousMeasurements: ReadonlyMap<number, Measurement> = new Map();

  function compose(node: N, width: number): Cached<N> {
    const presentation = present(node);

    if (presentation.kind !== 'text') throw new Error('Expected text presentation');
    const owner = (textLayout ??= engine.createLayout());
    const input = { ...presentation, id: node.id, width };

    if (presentation.atoms.length) {
      const layout = owner.layoutInline(input);

      return {
        node,
        presentation,
        width,
        height: layout.height,
        layout,
        boxes: layout.inlineBoxes,
      };
    }

    const layout = owner.layout(input);

    return {
      node,
      presentation,
      width,
      height: layout.height,
      layout,
      boxes: [],
    };
  }

  function gap(before: N, after: N) {
    return Math.max(present(before).after, present(after).before);
  }

  function firstAt(y: number) {
    let lo = 0,
      hi = previous.placements.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1,
        p = previous.placements[mid];

      if (p.y + p.height < y) lo = mid + 1;
      else hi = mid;
    }

    return lo;
  }

  return {
    build(
      nodes: readonly N[],
      width: number,
      measurements: ReadonlyMap<number, Measurement>,
      view: View,
      decorations: ReadonlyMap<number, { inset: number; endInset?: number }> = emptyInsets,
      flows: readonly FlowLayoutEvent<N>[] = emptyFlows,
    ) {
      currentDecorations = decorations;

      const availableWidth = (id: number) =>
        allocatedBlockWidth(
          width,
          decorations.get(id)?.inset ?? 0,
          decorations.get(id)?.endInset ?? 0,
        );

      const started = performance.now(),
        layoutIds: number[] = [];

      let compositionMs = 0;

      const padding = view.paddingTop ?? 0,
        paddingChanged = padding !== previous.paddingTop;

      const styleChanged = presentationVersion !== (view.presentationVersion ?? 0);
      let reflow = (fontsChanged || previous.width !== width) && previous.placements.length > 0;

      if (reflow || styleChanged) {
        dirty.clear();

        for (const [id, value] of cache)
          if (value.width !== availableWidth(id)) dirty.set(id, value.node);
      }

      // Resident scrolls reuse the scene. Crossing the resident window hydrates
      // from retained shaping, with no call across the shaping boundary.
      const viewportReady =
        previous.placements
          .slice(firstAt(view.top - 160), firstAt(view.top + view.height + 160) + 1)
          .every((p) => present(p.node).kind !== 'text' || p.layout !== null) &&
        view.pinned.every((id) => {
          const value = cache.get(id);

          return !value || value.layout !== null;
        });

      if (
        !fontsChanged &&
        !styleChanged &&
        nodes === previousNodes &&
        width === previous.width &&
        measurements === previousMeasurements &&
        decorations === previousDecorations &&
        flows === previousFlows &&
        !paddingChanged &&
        !dirty.size &&
        viewportReady
      ) {
        previous = { ...previous, top: view.top, zoom: view.zoom };

        return {
          scene: previous,
          layoutIds,
          reflow,
          background: 0,
          compositionMs,
          workMs: performance.now() - started,
        };
      }

      if (nodes !== previousNodes) {
        const live = new Set(nodes.map((n) => n.id));

        for (const id of cache.keys())
          if (!live.has(id)) {
            cache.delete(id);
            dirty.delete(id);
            textLayout?.release(id);
          }
      }

      const oldTop = (view.top * view.zoom) / previous.zoom;

      const oldAnchorIndex = firstAt(oldTop),
        anchor = previous.placements[oldAnchorIndex];

      const retainedAnchor = anchor ? nodes.findIndex((n) => n.id === anchor.node.id) : -1;

      const anchorIndex =
        retainedAnchor >= 0 ? retainedAnchor : Math.min(oldAnchorIndex, nodes.length - 1);

      const offset = anchor ? oldTop - anchor.y : oldTop - 32;

      const first = firstAt(oldTop - 160),
        pinned = new Set(view.pinned);

      let anchorY = anchor?.y ?? 32 + padding,
        y = 32 + padding,
        newLayouts = 0;

      const placements: Placement<N>[] = [];
      let flow = createFlowLayout(flows, width);

      function update(node: N) {
        const startedValue = performance.now(),
          value = compose(node, availableWidth(node.id));

        compositionMs += performance.now() - startedValue;
        cache.set(node.id, value);
        dirty.delete(node.id);
        layoutIds.push(node.id);

        return value;
      }

      // Prioritize from overscan through the viewport using the NEW line heights.
      // This also covers extra paragraphs exposed when text becomes shorter.
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index],
          inset = decorations.get(node.id)?.inset ?? 0,
          layoutWidth = availableWidth(node.id);

        y = flow.boundary(index, y, index > 0 ? gap(nodes[index - 1], node) : 0);

        if (index === anchorIndex) anchorY = y;

        const presentation = present(node);
        const oldPlacement = previous.placements[index];

        if (styleChanged && oldPlacement && oldPlacement.y !== y) reflow = true;

        if (presentation.kind === 'box') {
          if (cache.delete(node.id)) textLayout?.release(node.id);
          dirty.delete(node.id);
          const measured = measurements.get(node.id);
          const height = measured?.width === layoutWidth ? measured.height : presentation.height;

          if (styleChanged && oldPlacement && oldPlacement.height !== height) reflow = true;
          placements.push({ node, y, height, layout: null, layoutWidth: width, boxes: [] });
          y += snap(height, presentation.baselineGrid);
          continue;
        }

        let value = cache.get(node.id);
        const changed = !value || !sameText(value.presentation, presentation);

        if (styleChanged && value && (changed || value.width !== layoutWidth)) reflow = true;

        const urgent =
          (index >= first && (index <= anchorIndex || y <= anchorY + offset + view.height + 160)) ||
          pinned.has(node.id) ||
          (view.eager && (changed || value?.width !== layoutWidth));

        // Loading arrives in chunks of at most 128 blocks. Larger insertions
        // use the background queue, while the viewport and caret stay exact.
        if (
          (!value && (urgent || newLayouts < 128)) ||
          (value && urgent && (changed || value.width !== layoutWidth || !value.layout))
        ) {
          if (!value) newLayouts++;
          value = update(node);
        } else if (!value) {
          const columns = Math.max(1, Math.floor(layoutWidth / (presentation.size * 0.5)));

          const lines = presentation.text
            .split('\n')
            .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / columns)), 0);

          value = {
            node,
            presentation,
            width: null,
            height: lines * presentation.lineHeight,
            layout: null,
            boxes: [],
          };
          cache.set(node.id, value);
          dirty.set(node.id, node);
        } else if (changed || value.width !== layoutWidth) {
          // Keep the previous height until this paragraph is composed, but never
          // expose old glyphs for new content. A newer edit replaces queued work.
          dirty.set(node.id, node);

          if (changed && value.layout) {
            value = { ...value, layout: null, boxes: [] };
            cache.set(node.id, value);
            textLayout?.releaseLayout(node.id);
          }
        } else {
          dirty.delete(node.id);

          if (value.node !== node) {
            value = { ...value, node, presentation };
            cache.set(node.id, value);
          }
        }

        if (!value) throw new Error('Missing paragraph layout');
        placements.push({
          node,
          y,
          height: value.height,
          layout: value.layout ? offsetLayout(value.layout, inset) : null,
          layoutWidth: width,
          boxes: value.boxes.map((box) => ({ ...box, x: box.x + inset })),
        });
        y += value.height;
      }

      y = flow.boundary(nodes.length, y, 0);
      let background = 0;

      // Only scheduled ticks spend the background budget. Scroll and input merely
      // promote their visible/focused work. Queued nodes always carry the latest
      // content, including edits or undo while a width change is in progress.
      if (view.advance && !view.eager) {
        const deadline = performance.now() + 4;

        for (const [id, node] of dirty) {
          if (cache.has(id)) {
            update(node);
            background++;
          } else dirty.delete(id);

          if (background >= 128 || performance.now() >= deadline) break;
        }
      }

      // Publish fresh positions after the batch; earlier snapshots stay immutable.
      if (background) {
        y = 32 + padding;
        flow = createFlowLayout(flows, width);

        for (let index = 0; index < placements.length; index++) {
          const p = placements[index],
            value = present(p.node).kind === 'text' ? cache.get(p.node.id) : undefined;

          y = flow.boundary(index, y, index > 0 ? gap(nodes[index - 1], p.node) : 0);

          if (index === anchorIndex) anchorY = y;
          const inset = decorations.get(p.node.id)?.inset ?? 0;

          const next = value
            ? {
                ...p,
                y,
                height: value.height,
                layout: value.layout ? offsetLayout(value.layout, inset) : null,
                layoutWidth: width,
                boxes: value.boxes.map((box) => ({ ...box, x: box.x + inset })),
              }
            : { ...p, y };

          placements[index] = next;
          y += snap(next.height, present(p.node).baselineGrid);
        }
      }

      if (background) y = flow.boundary(nodes.length, y, 0);

      const newAnchor = placements[anchorIndex];
      // At the document's beginning, new chrome must remain visible instead of
      // being scrolled away by the reading-anchor adjustment.
      const keepStart = view.top < (previous.placements[0]?.y ?? 32);

      const top =
        anchor && !keepStart ? anchorY + Math.min(offset, newAnchor?.height ?? offset) : view.top;

      // Keep a small neighbourhood plus pinned interactions. Heights and shaping
      // survive eviction; neither the scene nor engine may retain draw geometry.
      if (!view.retainAll) {
        let end = first;

        while (end < placements.length && placements[end].y <= top + view.height + 160) end++;

        for (let index = 0; index < placements.length; index++) {
          const p = placements[index];

          if (
            present(p.node).kind !== 'text' ||
            pinned.has(p.node.id) ||
            (index >= Math.max(0, first - 48) && index < end + 48)
          )
            continue;
          const value = cache.get(p.node.id);

          if (value?.layout) {
            cache.set(p.node.id, { ...value, layout: null, boxes: [] });
            textLayout?.releaseLayout(p.node.id);
          }

          if (p.layout) placements[index] = { ...p, layout: null, boxes: [] };
        }
      }

      previous = {
        placements,
        flows: flow.placements,
        height: y + 24,
        width,
        top,
        zoom: view.zoom,
        pending: dirty.size,
        generation: previous.generation + Number(reflow),
        paddingTop: padding,
      };
      presentationVersion = view.presentationVersion ?? 0;
      fontsChanged = false;
      previousNodes = nodes;
      previousMeasurements = measurements;
      previousDecorations = decorations;
      previousFlows = flows;

      return {
        scene: previous,
        layoutIds,
        reflow,
        background,
        compositionMs,
        workMs: performance.now() - started,
      };
    },
    layoutFor(id: number) {
      const placement = previous.placements.find((p) => p.node.id === id);

      if (!placement || present(placement.node).kind !== 'text')
        throw new Error('Missing text layout');

      const value = cache.get(id),
        inset = currentDecorations.get(id)?.inset ?? 0,
        width = allocatedBlockWidth(
          previous.width,
          inset,
          currentDecorations.get(id)?.endInset ?? 0,
        );

      if (value?.layout && value.width === width && value.node === placement.node)
        return offsetLayout(value.layout, inset);
      // Measure for navigation without publishing a partly hydrated scene. The
      // selection update pins this block for the following normal scene build.
      const next = compose(placement.node, width);

      if (!next.layout) throw new Error('Missing composed layout');

      return offsetLayout(next.layout, inset);
    },
    replaceEngine(next: Pick<Owned, 'createLayout'>) {
      textLayout?.destroy();
      textLayout = undefined;
      engine = next;
      fontsChanged = true;

      // Retain heights and the reading anchor, but never reuse old font identities.
      for (const [id, value] of cache)
        cache.set(id, { ...value, width: null, layout: null, boxes: [] });
    },
    clear() {
      textLayout?.destroy();
      textLayout = undefined;
      cache.clear();
      dirty.clear();
      presentationVersion = 0;
      fontsChanged = false;
      previousNodes = [];
      previous = {
        placements: [],
        flows: new Map(),
        height: 50,
        width: 0,
        top: 0,
        zoom: 1,
        pending: 0,
        generation: 0,
        paddingTop: 0,
      };
      previousMeasurements = new Map();
      currentDecorations = emptyInsets;
      previousDecorations = emptyInsets;
      previousFlows = undefined;
    },
    get cachedParagraphs() {
      return cache.size;
    },
    get residentParagraphs() {
      return [...cache.values()].filter((p) => p.layout).length;
    },
  };
}

function snap(height: number, grid: number) {
  return grid > 0 ? Math.ceil(height / grid) * grid : height;
}

function sameText(a: TextPresentation, b: TextPresentation) {
  return (
    a === b ||
    (a.text === b.text &&
      a.size === b.size &&
      a.font?.family === b.font?.family &&
      a.font?.weight === b.font?.weight &&
      a.font?.style === b.font?.style &&
      a.lineHeight === b.lineHeight &&
      a.baselineGrid === b.baselineGrid &&
      (a.spans === b.spans ||
        (a.spans.length === b.spans.length &&
          a.spans.every((span, index) => {
            const next = b.spans[index];

            return (
              span.start === next.start &&
              span.end === next.end &&
              span.bold === next.bold &&
              span.italic === next.italic
            );
          }))) &&
      (a.atoms === b.atoms ||
        (a.atoms.length === b.atoms.length &&
          a.atoms.every((atom, index) => {
            const next = b.atoms[index];

            return (
              atom.id === next.id &&
              atom.index === next.index &&
              atom.label === next.label &&
              atom.width === next.width &&
              atom.ascent === next.ascent &&
              atom.descent === next.descent
            );
          }))))
  );
}

function offsetLayout(layout: LaidOut, inset: number): LaidOut {
  if (!inset) return layout;
  const shift = (r: Rect): Rect => [r[0] + inset, r[1], r[2] + inset, r[3]];

  return {
    ...layout,
    draw: (canvas, x, y, paint) => layout.draw(canvas, x + inset, y, paint),
    drawViewport: layout.drawViewport
      ? (canvas, x, y, top, bottom, paint) =>
          layout.drawViewport!(canvas, x + inset, y, top, bottom, paint)
      : undefined,
    hit: (x, y) => layout.hit(x - inset, y),
    geometry: (a, h, u) => {
      const g = layout.geometry(a, h, u);

      return { caret: shift(g.caret), rects: g.rects.map(shift) };
    },
  };
}
