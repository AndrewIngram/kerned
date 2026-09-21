import type { StandardSchemaV1 } from '@standard-schema/spec';

import { parseAttributes } from './attribute-validation';
import { definitionFamily, type SchemaDefinition } from './definitions';
import { freezeJson, type Immutable } from './immutable-json';
import type { Mark } from './marks';

export type ValueDefinition = Extract<SchemaDefinition, { category: 'mark' | 'inline' }>;

/** A canonical mark/inline value retains its attributes without reparsing on the hot path. */
export type ValueBinding<Definition extends ValueDefinition> = Readonly<{
  name: Definition['name'];
  create(attributes: StandardSchemaV1.InferInput<Definition['spec']['attributes']>): Mark;
  read(
    this: void,
    value: Mark,
  ): Readonly<{
    attrs: Immutable<StandardSchemaV1.InferOutput<Definition['spec']['attributes']>>;
  }> | null;
}>;

export function bindValue<Definition extends ValueDefinition>(
  installed: ValueDefinition | undefined,
  definition: Definition,
): ValueBinding<Definition> {
  if (!installed) throw new Error(`Missing ${definition.category} definition: ${definition.name}`);

  if (
    installed.category !== definition.category ||
    !definition[definitionFamily] ||
    installed[definitionFamily] !== definition[definitionFamily]
  )
    throw new Error(`Different ${definition.category} definition registered as ${definition.name}`);

  return Object.freeze({
    name: definition.name,
    create(attributes) {
      const parsed = parseAttributes(installed.spec, attributes, []);

      if ('issues' in parsed)
        throw new Error(parsed.issues.map((issue) => issue.message).join('; '));

      freezeJson({ attrs: parsed.value });

      return Object.freeze({ type: definition.name, attrs: parsed.value });
    },
    read(value: Mark) {
      if (value.type !== definition.name) return null;

      // SAFETY: Canonical values have passed the installed definition's validator. The
      // family check preserves their inferred type without rerunning transforms.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Restore attributes after checking the installed definition family and canonical value type.
      return value as Readonly<{
        attrs: Immutable<StandardSchemaV1.InferOutput<Definition['spec']['attributes']>>;
      }>;
    },
  });
}
