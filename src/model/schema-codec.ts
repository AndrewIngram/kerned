import { z } from 'zod';

import type { NodeIdentity, Schema } from './schema';
import { validateTree } from './tree';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { [key: string]: JsonValue };

type EncodedNode = NodeIdentity & {
  type: string;
  version: number;
  data: JsonValue;
  children: EncodedNode[];
};

export type NodeCodec<N> = {
  encode(node: N): JsonValue;
  decode(data: JsonValue, context: { identity: NodeIdentity; children: N[] }): N;
};

function invalidJson(message: string): never {
  throw new z.ZodError([{ code: 'custom', path: [], message }]);
}

/** Validate and copy JSON once, without constructing a validator for each nested value. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This function is the recursive boundary for arbitrary external JSON content.
function copyJson(value: unknown, depth: number): JsonValue {
  if (depth > 256) return invalidJson('JSON exceeds nesting limit');

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- External JSON has scalar, array and object variants without an application discriminator.
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : invalidJson('JSON requires finite numbers');
    case 'object': {
      if (value === null) return null;

      if (Array.isArray(value)) {
        const result: JsonValue[] = [];

        for (let index = 0; index < value.length; index++)
          result.push(copyJson(value[index], depth + 1));

        return result;
      }

      const prototype = Object.getPrototypeOf(value);

      if (prototype !== null && prototype !== Object.prototype)
        return invalidJson('JSON requires plain objects');
      const entries: [string, unknown][] = Object.entries(value);

      // fromEntries preserves __proto__ as an own data property.
      return Object.fromEntries(entries.map(([key, child]) => [key, copyJson(child, depth + 1)]));
    }

    default:
      return invalidJson('Invalid JSON value');
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public JSON import validates and owns untrusted values.
export function jsonValue(value: unknown): JsonValue {
  return copyJson(value, 0);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A record is an external JSON boundary, not a trusted internal shape.
export function jsonRecord(value: unknown): { [key: string]: JsonValue } {
  return readJsonRecord(jsonValue(value));
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** Internal projection for already-owned JSON; public jsonRecord still validates and copies. */
export function readJsonRecord(value: JsonValue): { [key: string]: JsonValue } {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Narrow the validated JSON scalar/array/object union to a record.
  if (value === null || typeof value !== 'object' || isJsonArray(value))
    return invalidJson('Expected a JSON object');

  return value;
}

export const jsonString = bindParser(z.string());

export const jsonNumber = bindParser(z.number());

export const jsonBoolean = bindParser(z.boolean());

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public array import accepts external content and validates every item.
export function jsonArray(value: unknown): JsonValue[] {
  if (!Array.isArray(value)) return invalidJson('Expected a JSON array');
  const result: JsonValue[] = [];

  for (let index = 0; index < value.length; index++) result.push(copyJson(value[index], 1));

  return result;
}

const json = z.unknown().transform(jsonValue);

function encodedNodeSchema(depth = 0): z.ZodType<EncodedNode> {
  if (depth > 256) return z.never({ error: 'Document exceeds decode depth' });

  return z.object({
    type: z.string(),
    version: z.number(),
    id: z.number().int(),
    key: z.string().min(1),
    locked: z.boolean().optional(),
    data: json,
    children: z.array(z.lazy(() => encodedNodeSchema(depth + 1))),
  });
}

/** Versioned document data only. Session history, references and feature stores persist separately. */
export function createDocumentCodec<N extends NodeIdentity>(schema: Schema<N>) {
  const byName = new Map(schema.extensions.map((extension) => [extension.name, extension]));

  const decode = bindParser(
    z
      .object({ version: z.literal(1), nodes: z.array(encodedNodeSchema()) })
      .transform((document) => {
        let count = 0;

        function node(data: EncodedNode, depth: number): N {
          if (depth > 256 || ++count > 1_000_000) throw new Error('Document exceeds decode limits');

          const type = data.type,
            extension = byName.get(type);

          if (!extension?.codec) throw new Error(`Missing node codec: ${type}`);

          if (data.version !== extension.version) throw new Error(`Unsupported ${type} version`);
          const { id, key } = data;

          if (!Number.isSafeInteger(id) || !key) throw new Error('Invalid node identity');
          const identity: NodeIdentity = { id, key };

          if (data.locked !== undefined) identity.locked = data.locked;
          const children = data.children.map((child) => node(child, depth + 1));

          if (extension.kind !== 'container' && children.length)
            throw new Error('Non-container has children');
          const result = extension.codec.decode(data.data, { identity, children });

          if (
            schema.resolve(result) !== extension ||
            result.id !== id ||
            result.key !== key ||
            result.locked !== identity.locked
          )
            throw new Error('Codec changed node identity or type');
          const actual = schema.children(result);

          if (actual.length !== children.length || actual.some((child, i) => child !== children[i]))
            throw new Error('Codec changed child content');

          return result;
        }

        const nodes = document.nodes.map((value) => node(value, 0));
        validateTree(schema, nodes);

        return nodes;
      }),
  );

  function encode(nodes: readonly N[]): JsonValue {
    validateTree(schema, nodes);

    function node(value: N, depth: number): EncodedNode {
      if (depth > 256) throw new Error('Document exceeds encode depth');
      const extension = schema.resolve(value);

      if (!extension.codec) throw new Error(`Missing node codec: ${extension.name}`);

      const encoded: EncodedNode = {
        type: extension.name,
        version: extension.version,
        id: value.id,
        key: value.key,
        data: jsonValue(extension.codec.encode(value)),
        children: schema.children(value).map((child) => node(child, depth + 1)),
      };

      if (value.locked !== undefined) encoded.locked = value.locked;

      return encoded;
    }

    return { version: 1, nodes: nodes.map((value) => node(value, 0)) };
  }

  return { encode, decode };
}

/** Zod parsers are callable without a receiver; bind that contract explicitly. */
export function bindParser<Output, Input>(schema: z.ZodType<Output, Input>) {
  return schema.parse.bind(schema);
}
