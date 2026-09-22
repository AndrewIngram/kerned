import { defineExtension, type ContributionContext } from '@gprose/core';
import { defineMarkView, viewLayers, type MarkViewFrame } from '@gprose/view';

import { underline } from '../starter-definitions';

type UnderlineOptions = { color?: string; offset: number; thickness: number };

const defaults: UnderlineOptions = { offset: 2, thickness: 1 };

/** Underline owns its appearance; the shared mark view owns projection and lifetime. */
export const underlineView = defineExtension({
  name: 'underlineView',
  options: defaults,
  requires: [underline.name],
  setup(options, context: ContributionContext) {
    context.provide(
      viewLayers,
      defineMarkView(underline, () => () => {
        let current: MarkViewFrame<typeof underline> | undefined;

        return {
          update(frame) {
            current = frame;
          },
          draw(drawing, layer) {
            if (!current || layer !== 'content') return;

            for (const fragment of current.fragments)
              drawing.rect(
                {
                  left: fragment.left,
                  top: fragment.baseline + options.offset,
                  width: fragment.width,
                  height: options.thickness,
                },
                options.color ?? current.color,
              );
          },
          destroy() {
            current = undefined;
          },
        };
      }),
    );

    return {};
  },
});
