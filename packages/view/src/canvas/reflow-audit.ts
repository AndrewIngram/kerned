import { createViewResources } from './resources.js';
import type { BlockPresentation } from './scene.js';
import type { ViewDiagnostics } from './view-diagnostics.js';

export type ReflowAuditBlock = Readonly<{ id: number; presentation: BlockPresentation }>;

/** Compare a flat presentation sequence with fresh, independently composed layout. */
export async function auditReflow({
  blocks,
  diagnostics,
  insets,
}: {
  blocks: readonly ReflowAuditBlock[];
  diagnostics: ViewDiagnostics;
  insets: Readonly<{ before: number; after: number }>;
}) {
  const scene = diagnostics.read();

  if (!scene) throw new Error('No current view diagnostics');
  const placements = diagnostics.placements();
  const resources = createViewResources();

  try {
    await resources.ready;
    const owner = resources.read().layout.createLayout();

    try {
      let y = insets.before + scene.paddingTop,
        paragraphs = 0,
        hydrated = 0;

      for (const [index, block] of blocks.entries()) {
        const presentation = block.presentation;
        const actual = placements[index];

        if (index) y += Math.max(blocks[index - 1].presentation.after, presentation.before);

        if (!actual || actual.id !== block.id || actual.y !== y)
          throw new Error(`Placement differs at ${block.id}`);

        if (presentation.kind === 'text') {
          const input = { ...presentation, id: -1, width: scene.width };

          const expected = presentation.atoms.length
            ? owner.layoutInline(input)
            : owner.layout(input);

          const probe = diagnostics.inspectText({
            id: block.id,
            range: { from: 0, to: presentation.text.length },
            move: { offset: 0, direction: 'end' },
            hit: { x: 10, y: 10 },
          });

          if (
            actual.height !== expected.height ||
            actual.layoutWidth !== scene.width ||
            (probe &&
              JSON.stringify([probe.height, probe.lines, probe.geometry, probe.move, probe.hit]) !==
                JSON.stringify([
                  expected.height,
                  expected.lines,
                  expected.geometry(0, presentation.text.length, false),
                  expected.move(0, false, 'end'),
                  expected.hit(10, 10),
                ]))
          )
            throw new Error(`Geometry differs at ${block.id}`);

          if (probe) hydrated++;

          if (
            probe &&
            'inlineBoxes' in expected &&
            JSON.stringify(actual.boxes) !== JSON.stringify(expected.inlineBoxes)
          )
            throw new Error(`Inline rectangles differ at ${block.id}`);
          y += expected.height;
          paragraphs++;
        } else {
          const height =
            actual.measured?.width === scene.width ? actual.measured.height : presentation.height;

          if (height !== actual.height) throw new Error(`Widget height differs at ${block.id}`);
          y +=
            presentation.baselineGrid > 0
              ? Math.ceil(height / presentation.baselineGrid) * presentation.baselineGrid
              : height;
        }
      }

      if (y + insets.after !== scene.height || scene.pending)
        throw new Error('Document reflow is incomplete');

      return { blocks: blocks.length, paragraphs, hydrated, checks: 'passed' };
    } finally {
      owner.destroy();
    }
  } finally {
    resources.destroy();
  }
}
