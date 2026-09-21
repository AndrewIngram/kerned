import type { StandardSchemaV1 } from '@standard-schema/spec';

import { definitionFamily, type SchemaDefinition } from './definitions';
import type { Immutable } from './immutable-json';
import type { NodeIdentity } from './schema';

export type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

export type NodeBinding<N, Definition extends NodeDefinition> = Readonly<{
  name: Definition['name'];
  matches(this: void, node: N): boolean;
  read(
    this: void,
    node: N,
  ): Immutable<StandardSchemaV1.InferOutput<Definition['spec']['attributes']>> | null;
  create(
    identity: NodeIdentity,
    attributes: StandardSchemaV1.InferInput<Definition['spec']['attributes']>,
    children?: readonly N[],
  ): N;
}>;

export type NodeFactory<N> = Readonly<{
  definition: NodeDefinition;
  attributes(node: N): object;
  copy(node: N, identity: NodeIdentity): N;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The erased factory passes caller attributes to the registered Standard Schema validator.
  create(identity: NodeIdentity, attributes: unknown, children: readonly N[]): N;
}>;

/** A binding recognizes configured variants of the installed definition, never a
 * different definition that happens to reuse its name. Reads trust canonical nodes. */
export function bindNode<N, const Definition extends NodeDefinition>(
  factory: NodeFactory<N>,
  definition: Definition,
  matches: (node: N) => boolean,
): NodeBinding<N, Definition> {
  const family = definition[definitionFamily];

  if (!family || factory.definition[definitionFamily] !== family)
    throw new Error(`Different node definition registered as ${definition.name}`);

  return Object.freeze({
    name: definition.name,
    matches,
    read(node: N) {
      if (!matches(node)) return null;

      // SAFETY: Matching the installed definition family establishes the attribute
      // shape; canonical nodes have already passed that definition's validator.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Restore the definition's attribute type after binding its installed family and checking the runtime node type.
      return factory.attributes(node) as Immutable<
        StandardSchemaV1.InferOutput<Definition['spec']['attributes']>
      >;
    },
    create(identity, attributes, children = []) {
      return factory.create(identity, attributes, children);
    },
  });
}
