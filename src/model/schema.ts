import { definitionFamily } from './definitions';
import type { InlineValue } from './inline-schema';
import type { Mark, MarkRange } from './marks';
import { bindNode, type NodeBinding, type NodeDefinition, type NodeFactory } from './node-binding';
import type { NodeCodec } from './schema-codec';
import { bindValue, type ValueBinding, type ValueDefinition } from './value-binding';

export type NodeIdentity = { id: number; key: string; locked?: boolean };

export type TextBehavior<N> = Readonly<{
  text(node: N): string;
  inline?: Readonly<{
    read(node: N): readonly InlineValue[];
    plainText(value: InlineValue): string;
  }>;
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
    groups?: readonly string[];
    factory?: NodeFactory<N>;
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
  const groups = type.groups ? Object.freeze([...type.groups]) : undefined;
  const factory = type.factory ? Object.freeze({ ...type.factory }) : undefined;
  const codec = type.codec ? Object.freeze({ ...type.codec }) : undefined;

  if (type.kind === 'text') {
    const marks = type.editing.marks ? Object.freeze({ ...type.editing.marks }) : undefined;

    return Object.freeze({
      ...type,
      codec,
      factory,
      groups,
      editing: Object.freeze({
        ...type.editing,
        marks,
        inline: type.editing.inline ? Object.freeze({ ...type.editing.inline }) : undefined,
      }),
    });
  }

  if (type.kind === 'container')
    return Object.freeze({
      ...type,
      codec,
      factory,
      groups,
      content: Object.freeze({ ...type.content }),
    });

  return Object.freeze({ ...type, codec, factory, groups });
}

/** Registration happens once. No schema name is privileged by the engine. */
export function createRuntimeSchema<N extends NodeIdentity & { kind: string }>(
  extensions: readonly NodeType<N>[],
  values: readonly ValueDefinition[] = [],
) {
  const registered = extensions.map(ownType);
  const registry = new Map(registered.map((extension) => [extension.name, extension]));
  const valueRegistry = new Map(values.map((definition) => [definition.name, definition]));

  function resolve(node: N) {
    const type = registry.get(node.kind);

    if (!type) throw new Error(`Unknown node kind: ${node.kind}`);

    return type;
  }

  function copy(node: N, allocate: () => NodeIdentity): N {
    const type = resolve(node);

    if (!type.factory) throw new Error(`No node factory registered for ${type.name}`);
    const cloned = type.factory.copy(node, allocate());

    return type.kind === 'container'
      ? type.content.withChildren(
          cloned,
          type.content.children(node).map((child) => copy(child, allocate)),
        )
      : cloned;
  }

  return {
    extensions: Object.freeze([...registered]),
    manifest: Object.freeze(
      registered.map(({ name, version }) => Object.freeze({ name, version })),
    ),
    resolve,
    copy,
    isNode(node: N, definition: NodeDefinition) {
      const installed = resolve(node).factory?.definition;
      const family = definition[definitionFamily];

      return !!family && installed?.[definitionFamily] === family;
    },
    value<const Definition extends ValueDefinition>(definition: Definition) {
      return bindValue(valueRegistry.get(definition.name), definition);
    },
    node<const Definition extends NodeDefinition>(
      definition: Definition,
    ): NodeBinding<N, Definition> {
      const type = registry.get(definition.name);

      if (!type?.factory) throw new Error(`No node factory registered for ${definition.name}`);

      return bindNode(type.factory, definition, (node) => resolve(node) === type);
    },
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
  /** Match a definition family without requiring it to be installed. */
  readonly isNode: (this: void, node: N, definition: NodeDefinition) => boolean;
  readonly value: <const Definition extends ValueDefinition>(
    definition: Definition,
  ) => ValueBinding<Definition>;
  readonly copy: (this: void, node: N, allocate: () => NodeIdentity) => N;
  readonly node: <const Definition extends NodeDefinition>(
    definition: Definition,
  ) => NodeBinding<N, Definition>;
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
