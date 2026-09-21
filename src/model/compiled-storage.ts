import type { ChildContent, RuntimeDocumentNode, TextContent } from './definitions';
import type { InlineValue } from './inline-schema';
import type { MarkRange } from './marks';

/**
 * Field names come from the compiled definition that validated this node.
 * Keep the four trusted storage projections here; callers never reparse trees
 * while reading geometry or moving a caret.
 */
export function textOf(node: RuntimeDocumentNode, content: TextContent): string {
  // SAFETY: Assembly validates the configured text field as a string before runtime operations.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The configured storage contract is established by assembly validation.
  return node[content.field] as string;
}

export function marksOf(node: RuntimeDocumentNode, content: TextContent): readonly MarkRange[] {
  // SAFETY: Assembly validates every range and mark in this configured storage field.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The configured storage contract is established by assembly validation.
  return content.marks ? (node[content.marks] as readonly MarkRange[]) : [];
}

export function inlineOf(node: RuntimeDocumentNode, content: TextContent): readonly InlineValue[] {
  // SAFETY: Assembly validates every inline value in this configured storage field.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The configured storage contract is established by assembly validation.
  return content.inline ? (node[content.inline] as readonly InlineValue[]) : [];
}

export function childrenOf(
  node: RuntimeDocumentNode,
  content: ChildContent,
): readonly RuntimeDocumentNode[] {
  if (content.depth === 2) {
    // SAFETY: Assembly validates nested child arrays from this exact definition.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The configured storage contract is established by assembly validation.
    return (node[content.field] as readonly (readonly RuntimeDocumentNode[])[]).flat();
  }

  // SAFETY: Assembly validates child arrays from this exact definition.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The configured storage contract is established by assembly validation.
  return node[content.field] as readonly RuntimeDocumentNode[];
}

export function withChildren(
  node: RuntimeDocumentNode,
  content: ChildContent,
  children: readonly RuntimeDocumentNode[],
): RuntimeDocumentNode {
  if (content.depth !== 2) return { ...node, [content.field]: children };
  const groups: RuntimeDocumentNode[][] = [];

  for (const child of children) {
    const group = child[content.groupBy];

    if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A generic schema field must establish a valid array index before regrouping changed children.
      typeof group !== 'number' ||
      !Number.isSafeInteger(group) ||
      group < 0 ||
      group > 1_000_000
    )
      throw new Error('Invalid child group index');
    (groups[group] ??= []).push(child);
  }

  return { ...node, [content.field]: groups };
}

/** Structural steps may temporarily empty a row; check grouping when the transaction commits. */
export function validateGroups(node: RuntimeDocumentNode, content: ChildContent) {
  if (content.depth !== 2) return;
  // SAFETY: The compiled container owns this nested-array field, including intermediate sparse groups during structural edits.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Runtime storage is established by assembly or withChildren before tree validation.
  const groups = node[content.field] as readonly (readonly RuntimeDocumentNode[])[];

  for (const [index, group] of groups.entries()) {
    if (!group?.length) throw new Error('Child groups must be nonempty and contiguous');

    if (group.some((child) => child[content.groupBy] !== index))
      throw new Error('Child group index does not match its position');
  }
}
