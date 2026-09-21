import type { StandardSchemaV1 } from '@standard-schema/spec';

import { jsonValue, type JsonValue } from './schema-codec';

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
