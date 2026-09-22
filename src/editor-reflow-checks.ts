import { auditReflow, type ViewDiagnostics, type ReflowAuditBlock } from '@gprose/view/diagnostics';

import type { StarterLeaf } from './extensions/demo-model';
import { formattingSpans } from './extensions/formatting';
import { inlineSchema } from './extensions/mention';
import { typography } from './extensions/typography';

/** The fixture owns schema-specific presentation; the view owns the independent layout audit. */
export function checkReflow(nodes: StarterLeaf[], diagnostics: ViewDiagnostics, bodySize = 20) {
  const blocks = nodes.map((node): ReflowAuditBlock => {
    if (node.kind === 'paragraph' || node.kind === 'heading') {
      const spans = formattingSpans(node.marks);

      if (node.kind === 'heading' && node.text.length)
        spans.push({ start: 0, end: node.text.length, bold: true, italic: false });

      return {
        id: node.id,
        presentation: {
          kind: 'text',
          ...typography(node, bodySize),
          baselineGrid: 4,
          text: node.text,
          spans,
          atoms: node.inline.map(inlineSchema.layout),
        },
      };
    }

    return {
      id: node.id,
      presentation: {
        kind: 'box',
        before: 0,
        after: 24,
        baselineGrid: 4,
        height: node.kind === 'image' ? 96 : Math.max(60, node.rows.length * 64),
      },
    };
  });

  return auditReflow({ blocks, diagnostics, insets: { before: 32, after: 24 } });
}
