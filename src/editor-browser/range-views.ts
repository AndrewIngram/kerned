import type { NodeIdentity, SchemaDefinition, ValueBinding } from '@gprose/model';
import {
  equalScopedSelection,
  selectionInText,
  type ScopedSelection,
  type NodeAccess,
} from '@gprose/state';

import type { Drawing, DrawingLayer, TextFragment } from './drawing';
import { createRangeViews } from './range-view-owner';
import type { LayerBlock, ViewLayerContext, ViewLayerContribution } from './view-layers';

type MarkDefinition = Extract<SchemaDefinition, { category: 'mark' }>;

type InlineDefinition = Extract<SchemaDefinition, { category: 'inline' }>;

type ValueDefinition = MarkDefinition | InlineDefinition;

export type ValueViewAttributes<D extends ValueDefinition> = NonNullable<
  ReturnType<ValueBinding<D>['read']>
>['attrs'];

export type InlineViewFrame<D extends InlineDefinition> = Readonly<{
  node: Readonly<NodeIdentity>;
  access: NodeAccess;
  selection: ScopedSelection;
  attributes: ValueViewAttributes<D>;
  id: string;
  index: number;
  width: number;
  height: number;
}>;

export type MarkViewFrame<D extends MarkDefinition> = Readonly<{
  node: Readonly<NodeIdentity>;
  access: NodeAccess;
  selection: ScopedSelection;
  attributes: ValueViewAttributes<D>;
  from: number;
  to: number;
  width: number;
  height: number;
  fragments: readonly TextFragment[];
  color: string;
}>;

export type RangeViewContext<N extends NodeIdentity> = Pick<
  ViewLayerContext<N>,
  'editor' | 'prepareText' | 'invalidate' | 'onDestroy'
>;

/** The view owns overlay placement and removal. Canvas-only instances need no DOM. */
export type RangeViewMount = {
  createOverlay(this: void, options?: { size: 'bounds' | 'content' }): HTMLDivElement;
};

export type RangeView<Frame> = {
  update(frame: Frame): void;
  /** Drawing coordinates are local to this instance's positioned overlay. */
  draw?(drawing: Drawing, layer: DrawingLayer): void;
  destroy(): void;
};

/** Schema-bound inline rendering with fixed geometry supplied by the text presentation. */
export function defineInlineView<D extends InlineDefinition>(
  definition: D,
  create: <N extends NodeIdentity>(
    context: RangeViewContext<N>,
  ) => (scope: RangeViewMount) => RangeView<InlineViewFrame<D>>,
): ViewLayerContribution {
  return {
    name: `inline:${definition.name}`,
    create(context) {
      const binding = context.editor.schema.value(definition);
      const frames = new Map<NodeIdentity, Map<string, InlineViewFrame<D>>>();

      return createRangeViews(
        context,
        (block) => {
          const type = context.editor.schema.resolve(block.node);

          if (type.kind !== 'text' || !block.inline.length) return [];
          const access = context.editor.getAccess(block.node.id);

          const selection = context.editor.getSelection(block.node.id);

          if (!access || !selection)
            throw new Error('Cannot render a node outside the current document');
          let cached = frames.get(block.node);

          if (!cached) {
            cached = new Map();

            for (const value of type.editing.inline?.read(block.node) ?? []) {
              const bound = binding.read(value);

              if (bound)
                cached.set(value.id, {
                  node: block.node,
                  access,
                  selection: selectionInText(
                    selection,
                    block.node.id,
                    value.index,
                    value.index + 1,
                  ),
                  attributes: bound.attrs,
                  id: value.id,
                  index: value.index,
                  width: 0,
                  height: 0,
                });
            }

            frames.set(block.node, cached);
          }

          return block.inline.flatMap((box) => {
            let frame = cached.get(box.id);

            if (!frame) return [];

            const scoped = selectionInText(selection, block.node.id, frame.index, frame.index + 1);

            if (
              !equalScopedSelection(frame.selection, scoped) ||
              frame.width !== box.width ||
              frame.height !== box.height ||
              frame.access !== access
            ) {
              frame = { ...frame, width: box.width, height: box.height, access, selection: scoped };
              cached.set(box.id, frame);
            }

            return [
              {
                key: JSON.stringify([block.node.id, box.id]),
                nodeId: block.node.id,
                bounds: { ...box, left: block.left + box.left, top: block.top + box.top },
                frame,
              },
            ];
          });
        },
        create,
        frames,
      );
    },
  };
}

/** A mark instance owns all its wrapped fragments; its underlying text stays canvas-owned. */
export function defineMarkView<D extends MarkDefinition>(
  definition: D,
  create: <N extends NodeIdentity>(
    context: RangeViewContext<N>,
  ) => (scope: RangeViewMount) => RangeView<MarkViewFrame<D>>,
): ViewLayerContribution {
  return {
    name: `mark:${definition.name}`,
    create(context) {
      const binding = context.editor.schema.value(definition);

      const cache = new Map<
        NodeIdentity,
        {
          text: LayerBlock<NodeIdentity>['text'];
          width: number;
          height: number;
          color: string;
          access: NodeAccess;
          frames: readonly MarkViewFrame<D>[];
        }
      >();

      return createRangeViews(
        context,
        (block, color) => {
          const type = context.editor.schema.resolve(block.node);

          if (type.kind !== 'text' || !block.text) return [];
          const access = context.editor.getAccess(block.node.id);

          const selection = context.editor.getSelection(block.node.id);

          if (!access || !selection)
            throw new Error('Cannot render a node outside the current document');
          let previous = cache.get(block.node);

          if (
            !previous ||
            previous.text !== block.text ||
            previous.width !== block.width ||
            previous.height !== block.height ||
            previous.color !== color ||
            previous.access !== access
          ) {
            const frames = (type.editing.marks?.read(block.node) ?? []).flatMap((range) => {
              const bound = binding.read(range.mark);

              return bound
                ? [
                    {
                      node: block.node,
                      access,
                      selection: selectionInText(selection, block.node.id, range.from, range.to),
                      attributes: bound.attrs,
                      from: range.from,
                      to: range.to,
                      width: block.width,
                      height: block.height,
                      fragments: block.text?.fragments(range.from, range.to) ?? [],
                      color,
                    },
                  ]
                : [];
            });

            previous = {
              text: block.text,
              width: block.width,
              height: block.height,
              color,
              access,
              frames,
            };
            cache.set(block.node, previous);
          }

          previous.frames = previous.frames.map((frame) => {
            const scoped = selectionInText(selection, block.node.id, frame.from, frame.to);

            return equalScopedSelection(frame.selection, scoped)
              ? frame
              : { ...frame, selection: scoped };
          });

          return previous.frames.map((frame) => ({
            key: JSON.stringify([block.node.id, frame.from, frame.to]),
            nodeId: block.node.id,
            bounds: block,
            frame,
          }));
        },
        create,
        cache,
      );
    },
  };
}
