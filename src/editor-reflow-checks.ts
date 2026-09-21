import type { ViewDiagnostics } from './editor-canvas/diagnostics';
import { createViewResources } from './editor-canvas/resources';
import type { StarterLeaf } from './extensions/demo-model';
import { formattingSpans } from './extensions/formatting';
import { inlineSchema } from './extensions/mention';
import { typography } from './extensions/typography';

/** Independent eager reference: compose each paragraph from scratch at the target width. */
export async function checkReflow(
  nodes: StarterLeaf[],
  diagnostics: ViewDiagnostics,
  bodySize = 20,
) {
  const scene = diagnostics.read();

  if (!scene) throw new Error('No current view diagnostics');
  const placements = diagnostics.placements();
  const resources = createViewResources();

  let y = 32 + scene.paddingTop,
    paragraphs = 0,
    hydrated = 0;

  try {
    await resources.ready;
    const owner = resources.read().layout.createLayout();

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i],
        actual = placements[i];

      if (i) {
        const previous = nodes[i - 1];

        const after =
          previous.kind === 'paragraph' || previous.kind === 'heading'
            ? typography(previous, bodySize).after
            : 24;

        const before =
          node.kind === 'paragraph' || node.kind === 'heading'
            ? typography(node, bodySize).before
            : 0;

        y += Math.max(after, before);
      }

      if (!actual || actual.id !== node.id || actual.y !== y)
        throw new Error(`Placement differs at ${node.id}`);

      if (node.kind === 'paragraph' || node.kind === 'heading') {
        const style = typography(node, bodySize);

        const spans =
          node.kind === 'heading' && node.text.length
            ? [
                ...formattingSpans(node.marks),
                { start: 0, end: node.text.length, bold: true, italic: false },
              ]
            : formattingSpans(node.marks);

        const input = {
          id: -1,
          text: node.text,
          spans,
          width: scene.width,
          size: style.size,
          lineHeight: style.lineHeight,
          baselineGrid: 4,
        };

        const expected = node.inline.length
          ? owner.layoutInline({ ...input, atoms: node.inline.map(inlineSchema.layout) })
          : owner.layout(input);

        const probe = diagnostics.inspectText({
          id: node.id,
          range: { from: 0, to: node.text.length },
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
                expected.geometry(0, node.text.length, false),
                expected.move(0, false, 'end'),
                expected.hit(10, 10),
              ]))
        )
          throw new Error(`Geometry differs at ${node.id}`);

        if (probe) hydrated++;

        if (
          probe &&
          'inlineBoxes' in expected &&
          JSON.stringify(actual.boxes) !== JSON.stringify(expected.inlineBoxes)
        )
          throw new Error(`Inline rectangles differ at ${node.id}`);
        y += expected.height;
        paragraphs++;
      } else {
        const measured = actual.measured;

        const height =
          measured?.width === scene.width
            ? measured.height
            : node.kind === 'image'
              ? 96
              : Math.max(60, node.rows.length * 64);

        if (height !== actual.height) throw new Error(`Widget height differs at ${node.id}`);
        y += Math.ceil(height / 4) * 4;
      }
    }

    if (y + 24 !== scene.height || scene.pending) throw new Error('Document reflow is incomplete');

    return { blocks: nodes.length, paragraphs, hydrated, checks: 'passed' };
  } finally {
    resources.destroy();
  }
}
