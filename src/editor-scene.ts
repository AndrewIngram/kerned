import type { LaidOut, Rect } from './engines';
import type { BlockDecoration } from './extensions/blocks';
import type { StarterLeaf, TextBlockNode } from './extensions/demo-model';
import { formattingSpans } from './extensions/formatting';
import { inlineSchema } from './extensions/mention';
import { typography } from './extensions/typography';
import type { createOwnedEngine } from './owned-layout';

type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

export type Placement = {
  node: StarterLeaf;
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

export type Scene = {
  placements: Placement[];
  height: number;
  width: number;
  top: number;
  zoom: number;
  pending: number;
  generation: number;
  paddingTop: number;
};

export type Measurement = { width: number; height: number };

type View = {
  top: number;
  height: number;
  zoom: number;
  pinned: readonly number[];
  advance: boolean;
  eager: boolean;
  retainAll: boolean;
  paddingTop?: number;
};

// Width is unknown until an inserted paragraph has been composed.
type Cached = {
  node: TextBlockNode;
  width: number | null;
  height: number;
  layout: LaidOut | null;
  boxes: Placement['boxes'];
};

export function createEditorScene(owned: Owned, size = 20) {
  let textLayout: ReturnType<Owned['createLayout']> | undefined;

  const cache = new Map<number, Cached>(),
    dirty = new Map<number, TextBlockNode>();

  let previous: Scene = {
    placements: [],
    height: 50,
    width: 0,
    top: 0,
    zoom: 1,
    pending: 0,
    generation: 0,
    paddingTop: 0,
  };

  let currentDecorations: ReadonlyMap<number, BlockDecoration> = new Map();

  let previousNodes: StarterLeaf[] = [],
    previousMeasurements: ReadonlyMap<number, Measurement> = new Map();

  function compose(node: TextBlockNode, width: number): Cached {
    const owner = (textLayout ??= owned.createLayout());

    const style = typography(node, size),
      spans =
        node.kind === 'heading' && node.text.length
          ? [
              ...formattingSpans(node.marks),
              { start: 0, end: node.text.length, bold: true, italic: false },
            ]
          : formattingSpans(node.marks);

    const input = {
      id: node.id,
      text: node.text,
      spans,
      width,
      size: style.size,
      lineHeight: style.lineHeight,
      baselineGrid: 4,
    };

    if (node.inline.length) {
      const layout = owner.layoutInline({ ...input, atoms: node.inline.map(inlineSchema.layout) });

      return { node, width, height: layout.height, layout, boxes: layout.inlineBoxes };
    }

    const layout = owner.layout(input);

    return { node, width, height: layout.height, layout, boxes: [] };
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
      nodes: StarterLeaf[],
      width: number,
      measurements: ReadonlyMap<number, Measurement>,
      view: View,
      decorations: ReadonlyMap<number, BlockDecoration> = new Map(),
    ) {
      currentDecorations = decorations;

      const started = performance.now(),
        layoutIds: number[] = [];

      let compositionMs = 0;

      const padding = view.paddingTop ?? 0,
        paddingChanged = padding !== previous.paddingTop;

      const reflow = previous.width !== width && previous.placements.length > 0;
      const generation = previous.generation + Number(reflow);

      if (reflow) {
        dirty.clear();

        for (const [id, value] of cache)
          if (value.width !== Math.max(80, width - (decorations.get(id)?.inset ?? 0)))
            dirty.set(id, value.node);
      }

      // Resident scrolls reuse the scene. Crossing the resident window hydrates
      // from retained shaping, with no call across the shaping boundary.
      const viewportReady =
        previous.placements
          .slice(firstAt(view.top - 160), firstAt(view.top + view.height + 160) + 1)
          .every(
            (p) => (p.node.kind !== 'paragraph' && p.node.kind !== 'heading') || p.layout !== null,
          ) &&
        view.pinned.every((id) => {
          const value = cache.get(id);

          return !value || value.layout !== null;
        });

      if (
        nodes === previousNodes &&
        width === previous.width &&
        measurements === previousMeasurements &&
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

      const placements: Placement[] = [];

      function update(node: TextBlockNode) {
        const startedValue = performance.now(),
          value = compose(node, Math.max(80, width - (decorations.get(node.id)?.inset ?? 0)));

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
          layoutWidth = Math.max(80, width - inset);

        if (index > 0) {
          const prev = nodes[index - 1];

          const after =
            prev.kind === 'paragraph' || prev.kind === 'heading'
              ? typography(prev, size).after
              : 24;

          const current = nodes[index];

          const before =
            current.kind === 'paragraph' || current.kind === 'heading'
              ? typography(current, size).before
              : 0;

          y += Math.max(after, before);
        }

        if (index === anchorIndex) anchorY = y;

        if (node.kind !== 'paragraph' && node.kind !== 'heading') {
          const measured = measurements.get(node.id);

          const height =
            measured?.width === width
              ? measured.height
              : node.kind === 'image'
                ? 96
                : Math.max(60, node.rows.length * 64);

          placements.push({ node, y, height, layout: null, layoutWidth: width, boxes: [] });
          y += Math.ceil(height / 4) * 4;
          continue;
        }

        let value = cache.get(node.id);

        const changed =
          !value ||
          value.node.kind !== node.kind ||
          (value.node.kind === 'heading' &&
            node.kind === 'heading' &&
            value.node.level !== node.level) ||
          value.node.text !== node.text ||
          value.node.marks !== node.marks ||
          value.node.inline !== node.inline;

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
          const style = typography(node, size),
            columns = Math.max(1, Math.floor(layoutWidth / (style.size * 0.5)));

          const lines = node.text
            .split('\n')
            .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / columns)), 0);

          value = { node, width: null, height: lines * style.lineHeight, layout: null, boxes: [] };
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
        } else dirty.delete(node.id);

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

        for (let index = 0; index < placements.length; index++) {
          const p = placements[index],
            value =
              p.node.kind === 'paragraph' || p.node.kind === 'heading'
                ? cache.get(p.node.id)
                : undefined;

          if (index > 0) {
            const prev = nodes[index - 1];

            const after =
              prev.kind === 'paragraph' || prev.kind === 'heading'
                ? typography(prev, size).after
                : 24;

            const current = nodes[index];

            const before =
              current.kind === 'paragraph' || current.kind === 'heading'
                ? typography(current, size).before
                : 0;

            y += Math.max(after, before);
          }

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
          y += Math.ceil(next.height / 4) * 4;
        }
      }

      const newAnchor = placements[anchorIndex];
      // Preserve the reading position when view chrome adds top space, except
      // at the document's beginning, where that space must remain visible.
      const keepStart = paddingChanged && view.top < (previous.placements[0]?.y ?? 32);

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
            (p.node.kind !== 'paragraph' && p.node.kind !== 'heading') ||
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
        height: y + 24,
        width,
        top,
        zoom: view.zoom,
        pending: dirty.size,
        generation,
        paddingTop: padding,
      };
      previousNodes = nodes;
      previousMeasurements = measurements;

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

      if (!placement || (placement.node.kind !== 'paragraph' && placement.node.kind !== 'heading'))
        throw new Error('Missing text layout');

      const value = cache.get(id),
        inset = currentDecorations.get(id)?.inset ?? 0,
        width = Math.max(80, previous.width - inset);

      if (value?.layout && value.width === width && value.node === placement.node)
        return offsetLayout(value.layout, inset);
      // Measure for navigation without publishing a partly hydrated scene. The
      // selection update pins this block for the following normal scene build.
      const next = compose(placement.node, width);

      if (!next.layout) throw new Error('Missing composed layout');

      return offsetLayout(next.layout, inset);
    },
    clear() {
      textLayout?.destroy();
      textLayout = undefined;
      cache.clear();
      dirty.clear();
      previousNodes = [];
      previous = {
        placements: [],
        height: 50,
        width: 0,
        top: 0,
        zoom: 1,
        pending: 0,
        generation: 0,
        paddingTop: 0,
      };
      previousMeasurements = new Map();
    },
    get cachedParagraphs() {
      return cache.size;
    },
    get residentParagraphs() {
      return [...cache.values()].filter((p) => p.layout).length;
    },
  };
}

function offsetLayout(layout: LaidOut, inset: number): LaidOut {
  if (!inset) return layout;
  const shift = (r: Rect): Rect => [r[0] + inset, r[1], r[2] + inset, r[3]];

  return {
    ...layout,
    draw: (canvas, x, y) => layout.draw(canvas, x + inset, y),
    drawViewport: layout.drawViewport
      ? (canvas, x, y, top, bottom) => layout.drawViewport!(canvas, x + inset, y, top, bottom)
      : undefined,
    hit: (x, y) => layout.hit(x - inset, y),
    geometry: (a, h, u) => {
      const g = layout.geometry(a, h, u);

      return { caret: shift(g.caret), rects: g.rects.map(shift) };
    },
  };
}
