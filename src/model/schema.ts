import type { Mark, MarkRange } from './marks';
import type { NodeCodec } from './schema-codec';

export type NodeIdentity = { id: number; key: string; locked?: boolean };

export type TextBehavior<N> = Readonly<{
  text(node: N): string;
  marks?: Readonly<{
    validate?(marks: readonly Mark[]): readonly Mark[];
    boundary?(mark: Mark, edge: 'start' | 'end'): boolean | undefined;
    read(node: N): readonly MarkRange[];
    write(node: N, marks: readonly MarkRange[]): N;
  }>;
  replace(node: N, from: number, to: number, text: string): N;
  split(node: N, at: number, right: NodeIdentity): [N, N];
  join(left: N, right: N): N;
}>;

export type NodeType<N> = Readonly<
  {
    selectable?: boolean;
    codec?: Readonly<NodeCodec<N>>;
    name: string;
    version: number;
    validateUpdate(before: N, after: N): void;
  } & (
    | { kind: 'text'; editing: TextBehavior<N> }
    | { kind: 'atom' }
    | {
        kind: 'container';
        content: Readonly<{
          children(node: N): readonly N[];
          withChildren(node: N, children: N[]): N;
          validateChildren(node: N, children: readonly N[], context: { parent: N | null }): void;
        }>;
      }
  )
>;

/** Own executable descriptors so consumers cannot change the meaning of an assembled schema. */
function ownType<N>(type: NodeType<N>): NodeType<N> {
  const codec = type.codec ? Object.freeze({ ...type.codec }) : undefined;

  if (type.kind === 'text') {
    const marks = type.editing.marks ? Object.freeze({ ...type.editing.marks }) : undefined;

    return Object.freeze({ ...type, codec, editing: Object.freeze({ ...type.editing, marks }) });
  }

  if (type.kind === 'container')
    return Object.freeze({ ...type, codec, content: Object.freeze({ ...type.content }) });

  return Object.freeze({ ...type, codec });
}

/** Registration happens once. No schema name is privileged by the engine. */
export function createRuntimeSchema<N extends NodeIdentity & { kind: string }>(
  extensions: readonly NodeType<N>[],
) {
  const registered = extensions.map(ownType);
  const registry = new Map(registered.map((extension) => [extension.name, extension]));

  function resolve(node: N) {
    const type = registry.get(node.kind);

    if (!type) throw new Error(`Unknown node kind: ${node.kind}`);

    return type;
  }

  return {
    extensions: Object.freeze([...registered]),
    manifest: Object.freeze(
      registered.map(({ name, version }) => Object.freeze({ name, version })),
    ),
    resolve,
    children(node: N): readonly N[] {
      const extension = resolve(node);

      return extension.kind === 'container' ? extension.content.children(node) : [];
    },
    withChildren(node: N, children: N[]): N {
      const extension = resolve(node);

      if (extension.kind !== 'container') throw new Error('Target is not a container');
      const next = extension.content.withChildren(node, children);

      if (next.id !== node.id || next.key !== node.key || resolve(next) !== extension)
        throw new Error('Container extension changed identity or type');
      const actual = extension.content.children(next);

      if (actual.length !== children.length || actual.some((child, i) => child !== children[i]))
        throw new Error('Container extension changed child content');

      return next;
    },
    validateChildren(node: N, parent: N | null) {
      const extension = resolve(node);

      if (extension.kind === 'container')
        extension.content.validateChildren(node, extension.content.children(node), { parent });
    },
    text(node: N) {
      const extension = resolve(node);

      return extension.kind === 'text' ? extension.editing.text(node) : null;
    },
    editing(node: N) {
      const extension = resolve(node);

      if (extension.kind !== 'text') throw new Error('This command requires editable text');

      return extension.editing;
    },
    validateUpdate(before: N, after: N) {
      const extension = resolve(before);

      if (resolve(after) !== extension) throw new Error('Property updates cannot change node type');
      extension.validateUpdate(before, after);
    },
  };
}

export type Schema<N> = {
  readonly extensions: readonly NodeType<N>[];
  readonly manifest: readonly Readonly<{ name: string; version: number }>[];
  readonly resolve: (this: void, node: N) => NodeType<N>;
  readonly children: (this: void, node: N) => readonly N[];
  readonly withChildren: (this: void, node: N, children: N[]) => N;
  readonly validateChildren: (this: void, node: N, parent: N | null) => void;
  readonly text: (this: void, node: N) => string | null;
  readonly editing: (this: void, node: N) => TextBehavior<N>;
  readonly validateUpdate: (this: void, before: N, after: N) => void;
};
