import { indexTree, type Schema } from '../model';
import { selectionContext, type EditorState } from '../state';
import { type Step } from '../transform';
import type { StarterNode, HeadingLevel } from './demo-model';

/** Change block semantics without replacing text identities or relative positions. */
export function setTextBlockType(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  ids: readonly number[],
  level: HeadingLevel | null,
  tree = indexTree(schema, state.nodes),
): Step<StarterNode>[] {
  return ids.flatMap((id) => {
    const entry = tree.byId.get(id);

    if (!entry) return [];
    const node = entry.node;

    if (node.kind !== 'paragraph' && node.kind !== 'heading') return [];

    if (
      (level === null && node.kind === 'paragraph') ||
      (node.kind === 'heading' && node.level === level)
    )
      return [];

    const content = {
      id: node.id,
      key: node.key,
      locked: node.locked,
      text: node.text,
      marks: node.marks,
      inline: node.inline,
    };

    const next: StarterNode =
      level === null ? { ...content, kind: 'paragraph' } : { ...content, kind: 'heading', level };

    return [
      {
        kind: 'replaceChildren',
        parent: entry.parent,
        index: entry.index,
        count: 1,
        nodes: [next],
      },
    ];
  });
}

/** The nearest structural wrapper describes ordinary text; headings keep their level. */
export function selectedBlockLabel(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  tree = indexTree(schema, state.nodes),
) {
  const context = selectionContext(schema, state.nodes, tree),
    empty = state.selection.isEmpty(context);

  const labels = new Set<string>();
  const ranges = state.selection.ranges(context);

  for (const range of ranges) {
    if (
      !empty &&
      range === ranges.at(-1) &&
      range.kind === 'text' &&
      range.from === 0 &&
      range.to === 0
    )
      continue;
    let entry = tree.byId.get(range.id);

    if (!entry) continue;
    const node = entry.node;

    if (node.kind === 'heading') {
      labels.add(`Heading ${node.level}`);
      continue;
    }

    let label =
      node.kind === 'image' ? 'Image' : node.kind === 'checklist' ? 'Checklist' : 'Paragraph';

    while (entry) {
      if (entry.node.kind === 'table' || entry.node.kind === 'tableCell') {
        label = 'Table';
        break;
      }

      if (entry.node.kind === 'list') {
        label = entry.node.ordered ? 'Numbered list' : 'Bullet list';
        break;
      }

      entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
    }

    labels.add(label);

    if (labels.size > 1) return 'Mixed';
  }

  return labels.size > 1 ? 'Mixed' : (labels.values().next().value ?? 'Paragraph');
}
