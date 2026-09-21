import { z } from 'zod';

import { type NodeIdentity, type Schema, indexTree, type TreeIndex } from '../model';
import type { Step } from '../transform';

export type NodeAccess = 'editable' | 'read-only' | 'protected';

/** Evaluate on a trusted document, with the authenticated principal captured by the caller. */
export type AccessPolicy<N extends NodeIdentity> = {
  access(node: N): NodeAccess;
  rootEditable?: boolean;
};

function inheritAccess(parent: NodeAccess, own: NodeAccess): NodeAccess {
  if (parent === 'protected' || own === 'protected') return 'protected';

  return parent === 'read-only' || own === 'read-only' ? 'read-only' : 'editable';
}

/** Query one current node without scanning unrelated branches or caching a mutable policy. */
export function nodeAccess<N extends NodeIdentity>(
  tree: TreeIndex<N>,
  id: number,
  policy?: AccessPolicy<N>,
): NodeAccess | undefined {
  let entry = tree.byId.get(id);

  if (!entry) return undefined;

  if (!policy) return 'editable';
  let access: NodeAccess = 'editable';

  while (entry) {
    access = inheritAccess(access, policy.access(entry.node));

    if (access === 'protected') return access;
    entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
  }

  return access;
}

export class PermissionDenied extends Error {
  constructor(
    readonly key: string | null,
    readonly operation: 'edit' | 'children' | 'delete-locked',
  ) {
    super(`Permission denied: ${operation}`);
    this.name = 'PermissionDenied';
  }
}

function effectiveAccess<N extends NodeIdentity>(tree: TreeIndex<N>, policy: AccessPolicy<N>) {
  const access = new Map<number, NodeAccess>();

  for (const { node, parent } of tree.order) {
    const inherited = parent === null ? 'editable' : (access.get(parent) ?? 'editable'),
      own = policy.access(node);

    access.set(node.id, inheritAccess(inherited, own));
  }

  return access;
}

const structuralValue = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

function equal<Value>(a: Value, b: Value): boolean {
  if (Object.is(a, b)) return true;

  if (
    a == null ||
    b == null ||
    !structuralValue.safeParse(a).success ||
    !structuralValue.safeParse(b).success
  )
    return false;
  const prototype = Object.getPrototypeOf(a);

  if (Array.isArray(a) !== Array.isArray(b) || prototype !== Object.getPrototypeOf(b)) return false;

  // Opaque application values (Dates, Maps, class instances) require identity.
  if (!Array.isArray(a) && prototype !== Object.prototype && prototype !== null) return false;

  const left = Object.entries(a),
    right = new Map(Object.entries(b));

  return (
    left.length === right.size &&
    left.every(([key, value]) => right.has(key) && equal(value, right.get(key)))
  );
}

function sameChildren<N extends NodeIdentity>(a: readonly N[], b: readonly N[]) {
  return a.length === b.length && a.every((node, index) => node.key === b[index].key);
}

/** Structural deletion is allowed; consuming protected/read-only text is not. */
export function assertContentEditAllowed<N extends NodeIdentity>(
  schema: Schema<N>,
  nodes: readonly N[],
  step: Step<N>,
  policy: AccessPolicy<N>,
): void {
  const ids =
    step.kind === 'replaceText' || step.kind === 'split'
      ? [step.id]
      : step.kind === 'join'
        ? [step.left, step.right]
        : step.kind === 'replaceRanges'
          ? step.ranges.flatMap((range) => (range.kind === 'text' ? [range.id] : []))
          : step.kind === 'updateBlock'
            ? [step.node.id]
            : [];

  if (!ids.length) return;

  const tree = indexTree(schema, nodes),
    access = effectiveAccess(tree, policy);

  for (const id of ids) {
    const node = tree.byId.get(id)?.node;

    if (node && access.get(id) !== 'editable') throw new PermissionDenied(node.key, 'edit');
  }
}

/** Validates the actual result, including indirect descendant deletion and history restoration. */
export function assertEditAllowed<N extends NodeIdentity>(
  schema: Schema<N>,
  before: readonly N[],
  after: readonly N[],
  policy: AccessPolicy<N>,
): void {
  const old = indexTree(schema, before),
    next = indexTree(schema, after),
    access = effectiveAccess(old, policy);

  if (policy.rootEditable === false && !sameChildren(before, after))
    throw new PermissionDenied(null, 'children');

  for (const { node } of old.order) {
    const replacement = next.byKey.get(node.key)?.node,
      editable = access.get(node.id) === 'editable';

    if (!replacement) {
      if (node.locked && !editable) throw new PermissionDenied(node.key, 'delete-locked');
      continue;
    }

    if (replacement === node) continue;

    const children = schema.children(node),
      newChildren = schema.children(replacement);

    if (!editable && !sameChildren(children, newChildren))
      throw new PermissionDenied(node.key, 'children');

    const payload =
      schema.resolve(node).kind === 'container' ? schema.withChildren(node, []) : node;

    const newPayload =
      schema.resolve(replacement).kind === 'container'
        ? schema.withChildren(replacement, [])
        : replacement;

    if (!editable && !equal(payload, newPayload)) throw new PermissionDenied(node.key, 'edit');
  }
}

export type ProjectedNode<N extends NodeIdentity> =
  | { kind: 'protected'; key: string; locked: boolean }
  | {
      kind: 'visible';
      access: 'editable' | 'read-only';
      node: N;
      children: readonly ProjectedNode<N>[];
    };

/** Produce this on the authority. Never send the trusted source snapshot or its steps to a restricted client. */
export function projectDocument<N extends NodeIdentity>(
  schema: Schema<N>,
  nodes: readonly N[],
  policy: AccessPolicy<N>,
): readonly ProjectedNode<N>[] {
  function project(node: N, inherited: NodeAccess): ProjectedNode<N> {
    const access = inheritAccess(inherited, policy.access(node));

    if (access === 'protected')
      return { kind: 'protected', key: node.key, locked: node.locked === true };
    const children = schema.children(node).map((child) => project(child, access));

    return {
      kind: 'visible',
      access,
      node: schema.resolve(node).kind === 'container' ? schema.withChildren(node, []) : node,
      children,
    };
  }

  return nodes.map((node) => project(node, 'editable'));
}
