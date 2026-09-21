import { defineExtension, type ContributionContext } from '../../core';
import {
  viewLayers,
  type DrawingRect,
  type ViewLayerContext,
  type ViewLayerFrame,
  type BlockTextGeometry,
  type TextFragment,
} from '../../editor-browser';
import type { NodeIdentity } from '../../model';
import { underline } from '../starter-definitions';

function createUnderlineView<N extends NodeIdentity>(
  { editor, paint }: ViewLayerContext<N>,
  options: { color: string; offset: number; thickness: number },
) {
  let previous = new Map<
    number,
    { node: N; text: BlockTextGeometry; fragments: readonly TextFragment[] }
  >();

  return {
    update({ blocks }: ViewLayerFrame<N>) {
      const retained = new Map<
        number,
        { node: N; text: BlockTextGeometry; fragments: readonly TextFragment[] }
      >();

      const rects: DrawingRect[] = [];

      for (const block of blocks) {
        const type = editor.schema.resolve(block.node);

        if (type.kind !== 'text' || !block.text) continue;
        let cached = previous.get(block.node.id);

        if (!cached || cached.node !== block.node || cached.text !== block.text) {
          const text = block.text;

          const fragments = (type.editing.marks?.read(block.node) ?? [])
            .filter((range) => range.mark.type === underline.name)
            .flatMap((range) => text.fragments(range.from, range.to));

          cached = { node: block.node, text, fragments };
        }

        retained.set(block.node.id, cached);

        for (const fragment of cached.fragments)
          rects.push({
            left: block.left + fragment.left,
            top: block.top + fragment.baseline + options.offset,
            width: fragment.width,
            height: options.thickness,
          });
      }

      previous = retained;
      paint(
        'content',
        rects.length
          ? (drawing) => {
              for (const rect of rects) drawing.rect(rect, options.color);
            }
          : null,
      );
    },
    destroy() {
      previous.clear();
    },
  };
}

/** Underline is a mark's view policy; the generic renderer only provides line geometry. */
export const underlineView = defineExtension({
  name: 'underlineView',
  options: { color: '#293227', offset: 2, thickness: 1 },
  requires: [underline.name],
  setup(options, context: ContributionContext) {
    context.provide(viewLayers, {
      name: 'underline',
      create: (viewContext) => createUnderlineView(viewContext, options),
    });

    return {};
  },
});
