import { mentionText } from '@kerned/extension-document';
import type { DocumentNode } from '@kerned/model';
import type { starterDefinitions } from '@kerned/starter-kit';
import type { TextSpan } from '@kerned/view';

export type StarterSpan = TextSpan & { underline?: boolean };

export type StarterNode = DocumentNode<typeof starterDefinitions>;

export type TextBlockNode = Extract<StarterNode, { kind: 'paragraph' | 'heading' }>;

export type HeadingLevel = Extract<StarterNode, { kind: 'heading' }>['level'];

export type ImageNode = Extract<StarterNode, { kind: 'image' }>;

export type TableCell = Extract<StarterNode, { kind: 'tableCell' }>;

export type TableNode = Extract<StarterNode, { kind: 'table' }>;

export type QuoteNode = Extract<StarterNode, { kind: 'quote' }>;

export type ListNode = Extract<StarterNode, { kind: 'list' }>;

export type ListItemNode = Extract<StarterNode, { kind: 'listItem' }>;

export type StarterLeaf = TextBlockNode | ImageNode | TableNode;

export function plainText(node: TextBlockNode, from = 0, to = node.text.length) {
  const labels = new Map(node.inline.map((value) => [value.index, mentionText(value)]));
  let result = '';

  for (let i = from; i < to; i++) result += labels.get(i) ?? node.text[i];

  return result;
}
