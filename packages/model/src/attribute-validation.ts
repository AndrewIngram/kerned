import type { StandardSchemaV1 } from '@standard-schema/spec';

import { sameJson } from './immutable-json.js';
import { jsonValue, type JsonValue } from './schema-codec.js';

type Path = readonly (string | number)[];

type ParsedValue = { value: JsonValue } | { issues: readonly StandardSchemaV1.Issue[] };

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Standard Schema validates unknown external content.
export function validateValue(schema: StandardSchemaV1, value: unknown, path: Path): ParsedValue {
  try {
    const result = schema['~standard'].validate(value);

    if ('then' in result) {
      // Observe rejection without delaying local editing or creating an unhandled rejection.
      void result.catch(() => undefined);

      return { issues: [{ message: 'Asynchronous schema validation is not supported', path }] };
    }

    if (result.issues)
      return {
        issues: result.issues.map((issue) => ({
          ...issue,
          path: [...path, ...(issue.path ?? [])],
        })),
      };

    return { value: jsonValue(result.value) };
  } catch (error) {
    return { issues: [{ message: error instanceof Error ? error.message : String(error), path }] };
  }
}

type AttributeRules = {
  attributes: StandardSchemaV1;
  outputAttributes?: StandardSchemaV1;
};

/** Canonical data can be checked, but validation must never change an accepted document. */
export function validateAttributes(
  spec: AttributeRules,
  value: JsonValue,
  path: Path,
): ParsedValue {
  const result = validateValue(spec.outputAttributes ?? spec.attributes, jsonValue(value), path);

  if ('issues' in result) return result;

  if (!sameJson(value, result.value))
    return {
      issues: [
        {
          message:
            'Canonical attribute validation must not normalize values or invalidate position mappings',
          path,
        },
      ],
    };

  return { value };
}

export function parseAttributes(
  spec: AttributeRules,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Attribute import is an untrusted Standard Schema boundary.
  value: unknown,
  path: Path,
): ParsedValue {
  const parsed = validateValue(spec.attributes, value, path);

  if ('issues' in parsed) return parsed;
  const canonical = validateAttributes(spec, parsed.value, path);

  if ('issues' in canonical && !spec.outputAttributes)
    return {
      issues: canonical.issues.map((issue) => ({
        ...issue,
        message: `Provide outputAttributes to validate normalized output: ${issue.message}`,
      })),
    };

  return canonical;
}

function checked(result: ParsedValue) {
  if ('issues' in result) throw new Error(result.issues.map((issue) => issue.message).join('; '));

  return result.value;
}

/** Private executable adapters share the same import/canonical rules as Standard validation. */
export function attributeFunctions(spec: AttributeRules) {
  return {
    parse: (value: JsonValue) => checked(parseAttributes(spec, value, [])),
    validate: (value: JsonValue) => checked(validateAttributes(spec, value, [])),
  };
}
