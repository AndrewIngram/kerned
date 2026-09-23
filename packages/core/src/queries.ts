import type { NodeIdentity } from '@kerned/model';
import type { ReadContext } from '@kerned/state';

export type SelectedValue<Value> =
  | { kind: 'none' }
  | { kind: 'uniform'; value: Value }
  | { kind: 'mixed' };

/** Extensions choose which ranges participate and how structured attribute values compare. */
export function selectedValue<Value>(
  values: Iterable<Value>,
  equal: (left: Value, right: Value) => boolean = Object.is,
): SelectedValue<Value> {
  let result: SelectedValue<Value> = { kind: 'none' };

  for (const value of values) {
    if (result.kind === 'none') result = { kind: 'uniform', value };
    else if (!equal(result.value, value)) return { kind: 'mixed' };
  }

  return result;
}

// Query values are extension-defined and recovered by NamedQueries at the public session.
export type QueryDefinitions<N extends NodeIdentity> = Readonly<
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- Private erased callback registry; callers retain each installed query result type.
  Record<string, (context: ReadContext<N>, ...args: never[]) => unknown>
>;

export type NamedQueries<Definitions> = {
  readonly [Name in keyof Definitions]: Definitions[Name] extends (
    state: never,
    ...args: infer Args
  ) => infer Value
    ? (...args: Args) => Value
    : never;
};

export function queryRegistry<N extends NodeIdentity>(
  getContext: () => ReadContext<N>,
  contributions: readonly { name: string; queries?: QueryDefinitions<N> }[],
) {
  const names = new Map<string, string>();
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- Erased callbacks are adapted once and exposed with their installed return types.
  const entries: [string, (...args: never[]) => unknown][] = [];

  for (const contribution of contributions) {
    for (const [name, query] of Object.entries(contribution.queries ?? {})) {
      if (!name || name === 'then') throw new Error(`Reserved query name: ${name}`);

      if (names.has(name))
        throw new Error(`Duplicate query ${name}: ${names.get(name)} and ${contribution.name}`);
      names.set(name, contribution.name);
      entries.push([name, (...args: never[]) => query(getContext(), ...args)]);
    }
  }

  return Object.freeze(Object.fromEntries(entries));
}
