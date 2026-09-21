import type { Mark, MarkRange } from './marks';
import type { NodeCodec } from './schema-codec';

export type NodeIdentity = { id: number; key: string; locked?: boolean };

export type TextBehavior<N extends NodeIdentity> = {
  text(node: N): string;
  marks?: {
    validate?(marks: readonly Mark[]): readonly Mark[];
    boundary?(mark: Mark, edge: 'start' | 'end'): boolean | undefined;
    read(node: N): readonly MarkRange[];
    write(node: N, marks: readonly MarkRange[]): N;
  };
  replace(node: N, from: number, to: number, text: string): N;
  split(node: N, at: number, right: NodeIdentity): [N, N];
  join(left: N, right: N): N;
};

export type NodeExtension<N extends NodeIdentity> = {
  selectable?: boolean;
  codec?: NodeCodec<N>;
  name: string;
  version: number;
  accepts(node: N): boolean;
  validateUpdate(before: N, after: N): void;
} & (
  | { kind: 'text'; editing: TextBehavior<N> }
  | { kind: 'atom' }
  | {
      kind: 'container';
      content: {
        children(node: N): readonly N[];
        withChildren(node: N, children: N[]): N;
        validateChildren(node: N, children: readonly N[], context: { parent: N | null }): void;
      };
    }
);

/** Registration happens once. No schema name is privileged by the engine. */
export function createSchema<N extends NodeIdentity>(extensions: readonly NodeExtension<N>[]) {
  const registered: readonly NodeExtension<N>[] = [...extensions];
  const names = new Set<string>();

  for (const extension of registered) {
    if (!extension.name || !Number.isSafeInteger(extension.version) || extension.version < 1)
      throw new Error('Extensions require a name and positive schema version');

    if (names.has(extension.name)) throw new Error(`Duplicate extension: ${extension.name}`);
    names.add(extension.name);
  }

  function resolve(node: N) {
    const matches = registered.filter((extension) => extension.accepts(node));

    if (matches.length !== 1)
      throw new Error(`Expected one extension for block ${node.key}, found ${matches.length}`);

    return matches[0];
  }

  return {
    extensions: Object.freeze([...registered]),
    manifest: registered.map(({ name, version }) => ({ name, version })),
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

export type Schema<N extends NodeIdentity> = ReturnType<typeof createSchema<N>>;
