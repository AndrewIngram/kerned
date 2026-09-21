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

/** Bound recursion before traversing untrusted JSON, including cyclic objects. */
function jsonSchema(depth = 0): z.ZodType<JsonValue> {
  if (depth > 256) return z.never({ error: 'JSON exceeds nesting limit' });
  const child = z.lazy(() => jsonSchema(depth + 1));

  return z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(child),
    jsonObjectSchema(child),
  ]);
}

/** Validate entries individually so legal JSON keys such as __proto__ survive copying. */
function jsonObjectSchema(valueSchema: z.ZodType<JsonValue>) {
  return z.unknown().transform((value) => {
    z.record(z.string(), z.unknown()).parse(value);

    // SAFETY: the record parser above established a non-null plain object.
    return Object.fromEntries(
      Object.entries(value!).map(([name, item]) => [name, valueSchema.parse(item)]),
    );
  });
}

const json = jsonSchema();

export const jsonValue = bindParser(json);

export const jsonRecord = bindParser(jsonObjectSchema(json));

export const jsonString = bindParser(z.string());

export const jsonNumber = bindParser(z.number());

export const jsonBoolean = bindParser(z.boolean());

export const jsonArray = bindParser(z.array(json));

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
