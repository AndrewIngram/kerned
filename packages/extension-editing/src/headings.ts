import { paragraph, heading } from '@gprose/extension-document';
import type { HeadingLevel } from '@gprose/extension-document';
import { indexTree, type NodeIdentity, type Schema } from '@gprose/model';
import { type EditorState } from '@gprose/state';
import { type Step } from '@gprose/transform';

/** Change block semantics without replacing text identities or relative positions. */
export function setTextBlockType<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  ids: readonly number[],
  level: HeadingLevel | null,
  tree = indexTree(schema, state.nodes),
): Step<N>[] {
  const paragraphs = schema.node(paragraph);
  const headings = schema.node(heading);

  const selected = new Set<number>();
  const pending = [...ids];

  while (pending.length) {
    const id = pending.pop();
    const entry = id === undefined ? undefined : tree.byId.get(id);

    if (!entry || selected.has(entry.node.id)) continue;
    selected.add(entry.node.id);
    pending.push(...schema.children(entry.node).map((child) => child.id));
  }

  return [...selected].flatMap((id) => {
    const entry = tree.byId.get(id);

    if (!entry) return [];
    const node = entry.node;
    const current = headings.read(node);

    if (!paragraphs.matches(node) && !current) return [];

    if ((level === null && paragraphs.matches(node)) || current?.level === level) return [];

    const target =
      level === null
        ? paragraphs.create(node, { text: '' })
        : headings.create(node, { text: '', level });

    // Joining into an empty target transfers text, marks and inline objects through
    // the target's editing policy, including its configured content restrictions.
    const next = schema.editing(target).join(target, node);

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
