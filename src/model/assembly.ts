import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { parseAttributes, validateAttributes } from './attribute-validation';
import { compileSchema } from './compiled-schema';
import { childPolicy } from './content-policy';
import type {
  DocumentInput,
  DocumentOutput,
  DocumentNode,
  DocumentMark,
  DocumentInline,
  SchemaDefinition,
} from './definitions';
import { freezeJson } from './immutable-json';
import { validateInlineObjects } from './inline';
import type { createInlineValues } from './inline-schema';
import { normalizeMarks, type MarkRange } from './marks';
import type { createMarkSchema } from './marks';
import type { Schema } from './schema';
import { jsonRecord, jsonValue, type JsonValue } from './schema-codec';
import { validateTextRange } from './text';

type Issue = StandardSchemaV1.Issue;

type Path = readonly (string | number)[];

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

type ValueDefinition = Extract<SchemaDefinition, { category: 'mark' | 'inline' }>;

type NodeFields = { id: number; key: string; kind: string; [field: string]: JsonValue };

type NodeDraft = { fields: NodeFields; path: Path; id?: number; key?: string };

const record = z.record(z.string(), z.unknown());

const identity = z.object({
  kind: z.string().min(1),
  id: z.number().int().optional(),
  key: z.string().min(1).optional(),
  locked: z.boolean().optional(),
});

const markRange = z.strictObject({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  mark: z.strictObject({ type: z.string().min(1), attrs: z.unknown() }),
});

const inlineValue = z.strictObject({
  type: z.string().min(1),
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  attrs: z.unknown(),
});

function prefixed(issues: readonly Issue[], path: Path): Issue[] {
  return issues.map((issue) => ({ ...issue, path: [...path, ...(issue.path ?? [])] }));
}

type TypedMarks<D extends readonly SchemaDefinition[]> = string extends D[number]['name']
  ? ReturnType<typeof createMarkSchema>
  : Readonly<
      Omit<
        ReturnType<typeof createMarkSchema>,
        'create' | 'validate' | 'validateMark' | 'decode'
      > & {
        create<Type extends DocumentMark<D>['type']>(
          type: Type,
          attrs: Extract<DocumentMark<D, 'input'>, { type: Type }>['attrs'],
        ): Extract<DocumentMark<D>, { type: Type }>;
        validateMark(mark: MarkRange['mark']): DocumentMark<D>;
        validate(
          text: string,
          ranges: readonly MarkRange[],
        ): { from: number; to: number; mark: DocumentMark<D> }[];
        decode(
          text: string,
          value: JsonValue,
        ): { from: number; to: number; mark: DocumentMark<D> }[];
      }
    >;

type TypedInline<D extends readonly SchemaDefinition[]> = string extends D[number]['name']
  ? ReturnType<typeof createInlineValues>
  : Readonly<
      Omit<ReturnType<typeof createInlineValues>, 'create' | 'decode'> & {
        create<Type extends DocumentInline<D>['type']>(
          type: Type,
          id: string,
          index: number,
          attrs: Extract<DocumentInline<D, 'input'>, { type: Type }>['attrs'],
        ): Extract<DocumentInline<D>, { type: Type }>;
        decode(text: string, value: JsonValue): DocumentInline<D>[];
      }
    >;

export type AssembledSchema<Definitions extends readonly SchemaDefinition[]> = Schema<
  DocumentNode<Definitions>
> & {
  readonly marks: TypedMarks<Definitions>;
  readonly inline: TypedInline<Definitions>;
  readonly definitions: Readonly<Definitions>;
  /** Validate canonical nodes without replaying import normalization. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Persisted normalized content still needs validation at the document boundary.
  readonly validateDocument: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Canonical document validation is an external content boundary.
    input: unknown,
  ) => StandardSchemaV1.Result<DocumentOutput<Definitions>>;
  readonly '~standard': Omit<
    StandardSchemaV1.Props<DocumentInput<Definitions>, DocumentOutput<Definitions>>,
    'validate'
  > & {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Standard Schema requires an unknown-input validation boundary.
    validate(input: unknown): StandardSchemaV1.Result<DocumentOutput<Definitions>>;
  };
};

/** Compile structured-content validation and editing from the same definition tuple. */
export function createSchema<const Definitions extends readonly SchemaDefinition[]>(config: {
  extensions: Definitions;
}): AssembledSchema<Definitions>;
export function createSchema(config: {
  extensions: readonly SchemaDefinition[];
}): AssembledSchema<readonly SchemaDefinition[]> {
  const definitions = [...config.extensions];
  const registry = new Map<string, SchemaDefinition>();

  for (const definition of definitions) {
    if (
      !definition.name ||
      (definition.category !== 'behavior' &&
        (!Number.isSafeInteger(definition.version) || definition.version < 1))
    )
      throw new Error('Extensions require a name and positive schema version');

    if (registry.has(definition.name)) throw new Error(`Duplicate extension: ${definition.name}`);
    registry.set(definition.name, definition);
  }

  for (const definition of definitions) {
    for (const required of definition.requires)
      if (!registry.has(required))
        throw new Error(`Missing dependency ${required} for ${definition.name}`);

    if (definition.category !== 'node') continue;
    const content = definition.spec.content;

    if (content.kind !== 'atom') {
      const fields = [
        content.field,
        ...(content.kind === 'text'
          ? [content.marks, content.inline].filter((field) => field !== undefined)
          : []),
      ];

      if (
        fields.some(
          (field) => !field || ['id', 'key', 'kind', 'locked', '__proto__'].includes(field),
        ) ||
        new Set(fields).size !== fields.length
      )
        throw new Error(`Invalid or overlapping content fields for ${definition.name}`);

      if (
        content.kind === 'container' &&
        content.minChildren !== undefined &&
        (!Number.isSafeInteger(content.minChildren) || content.minChildren < 0)
      )
        throw new Error(`Invalid child minimum for ${definition.name}`);
    }

    const references =
      content.kind === 'container'
        ? [...(content.allowed ?? []), ...(content.first ?? []), ...(content.parents ?? [])].map(
            (name) => ({ name, category: 'node' }),
          )
        : content.kind === 'text'
          ? [
              ...(content.allowedMarks ?? []).map((name) => ({ name, category: 'mark' })),
              ...(content.allowedInline ?? []).map((name) => ({ name, category: 'inline' })),
              ...(content.emptySplit ? [{ name: content.emptySplit, category: 'node' }] : []),
            ]
          : [];

    for (const reference of references)
      if (registry.get(reference.name)?.category !== reference.category)
        throw new Error(`Missing ${reference.category} ${reference.name} for ${definition.name}`);

    if (content.kind === 'text' && content.emptySplit) {
      const target = registry.get(content.emptySplit);

      if (target?.category !== 'node' || target.spec.content.kind !== 'text')
        throw new Error('Empty split requires a text node');
    }
  }

  const childPolicies = new Map(
    definitions.flatMap((definition) =>
      definition.category === 'node' && definition.spec.content.kind === 'container'
        ? [[definition.name, childPolicy(definition.spec.content, definitions)] as const]
        : [],
    ),
  );

  function validate(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the official unknown-input Standard Schema boundary.
    input: unknown,
    canonical = false,
  ): StandardSchemaV1.Result<DocumentOutput<readonly SchemaDefinition[]>> {
    const issues: Issue[] = [];
    const drafts: NodeDraft[] = [];
    const objects = new WeakSet<object>();
    let count = 0;
    let exhausted = false;

    function issue(message: string, path: Path) {
      issues.push({ message, path });
    }

    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A node field from external structured content has not been validated yet.
    function attributes(definition: NodeDefinition | ValueDefinition, value: unknown, path: Path) {
      let result;

      try {
        result = canonical
          ? validateAttributes(definition.spec, jsonValue(value), path)
          : parseAttributes(definition.spec, value, path);
      } catch (error) {
        issue(error instanceof Error ? error.message : String(error), path);

        return null;
      }

      if ('issues' in result) {
        issues.push(...result.issues);

        return null;
      }

      return result;
    }

    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Child arrays are parsed at the external document boundary.
    function children(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parameter is parsed inside the external document boundary.
      value: unknown,
      path: Path,
      depth: number,
      allowed?: readonly string[],
      parent?: string,
    ): NodeFields[] {
      const parsed = z.array(z.unknown()).safeParse(value);

      if (!parsed.success) {
        issues.push(...prefixed(parsed.error.issues, path));

        return [];
      }

      const result: NodeFields[] = [];

      for (const [index, child] of parsed.data.entries()) {
        if (exhausted) break;
        const parsedChild = node(child, [...path, index], depth, allowed, parent);

        if (parsedChild) result.push(parsedChild);
      }

      return result;
    }

    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each node is unknown until its metadata and declared attributes validate.
    function node(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parameter is parsed inside the external document boundary.
      value: unknown,
      path: Path,
      depth: number,
      allowed?: readonly string[],
      parent?: string,
    ): NodeFields | null {
      if (depth > 256 || ++count > 1_000_000) {
        exhausted = true;
        issue('Document exceeds validation limits', path);

        return null;
      }

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Preserve original object identity when checking untrusted input for cycles.
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        issue('Expected a document node object', path);

        return null;
      }

      const data = record.safeParse(value);

      if (!data.success) {
        issues.push(...prefixed(data.error.issues, path));

        return null;
      }

      // The record parser established an object; tracking the original catches cyclic inputs.
      if (objects.has(value)) {
        issue('Cyclic or shared document node', path);

        return null;
      }

      objects.add(value);
      const meta = identity.safeParse(data.data);

      if (!meta.success) {
        issues.push(...prefixed(meta.error.issues, path));

        return null;
      }

      if (canonical && (meta.data.id === undefined || meta.data.key === undefined)) {
        issue('Canonical document nodes require id and key', path);

        return null;
      }

      const definition = registry.get(meta.data.kind);

      if (!definition || definition.category !== 'node') {
        issue(`Unknown node: ${meta.data.kind}`, [...path, 'kind']);

        return null;
      }

      if (allowed && !allowed.includes(definition.name)) {
        issue(`Node ${definition.name} is not allowed here`, [...path, 'kind']);

        return null;
      }

      const content = definition.spec.content;
      const reserved = new Set(['id', 'key', 'kind', 'locked']);

      if (content.kind === 'container') reserved.add(content.field);

      if (content.kind === 'text') {
        if (content.marks) reserved.add(content.marks);

        if (content.inline) reserved.add(content.inline);
      }

      const attrs = attributes(
        definition,
        Object.fromEntries(Object.entries(data.data).filter(([key]) => !reserved.has(key))),
        path,
      );

      if (!attrs) return null;
      const parsedAttrs = record.safeParse(attrs.value);

      if (!parsedAttrs.success || attrs.value === null || Array.isArray(attrs.value)) {
        issue('Node attributes must normalize to an object', path);

        return null;
      }

      const fields = Object.assign(jsonRecord(attrs.value), {
        kind: definition.name,
        id: meta.data.id ?? 0,
        key: meta.data.key ?? '',
      });

      if (Object.keys(parsedAttrs.data).some((key) => reserved.has(key))) {
        issue('Attribute validator returned a reserved node field', path);

        return null;
      }

      if (meta.data.locked !== undefined) fields.locked = meta.data.locked;
      drafts.push({ fields, path, id: meta.data.id, key: meta.data.key });

      if (content.kind === 'container') {
        const policy = childPolicies.get(definition.name)!;

        if (content.parents && (!parent || !content.parents.includes(parent)))
          issue(`Node ${definition.name} requires parent ${content.parents.join(' or ')}`, [
            ...path,
            'kind',
          ]);

        if (content.depth === 2) {
          const rows = z.array(z.unknown()).safeParse(data.data[content.field] ?? []);

          if (!rows.success) issues.push(...prefixed(rows.error.issues, [...path, content.field]));
          else
            fields[content.field] = rows.data.map((row, index) => {
              const grouped = children(
                row,
                [...path, content.field, index],
                depth + 1,
                policy.allowed,
                definition.name,
              );

              if (!grouped.length)
                issue('Child groups cannot be empty', [...path, content.field, index]);

              for (const [column, child] of grouped.entries())
                if (child[content.groupBy] !== index)
                  issue('Child group index does not match its position', [
                    ...path,
                    content.field,
                    index,
                    column,
                    content.groupBy,
                  ]);

              return grouped;
            });
        } else
          fields[content.field] = children(
            data.data[content.field] ?? [],
            [...path, content.field],
            depth + 1,
            policy.allowed,
            definition.name,
          );

        const nested = fields[content.field];

        const descendants = Array.isArray(nested)
          ? content.depth === 2
            ? nested.flat()
            : nested
          : [];

        if (descendants.length < (content.minChildren ?? 0))
          issue(`Node ${definition.name} requires at least ${content.minChildren} children`, [
            ...path,
            content.field,
          ]);

        if (policy.first && descendants.length) {
          const first = z.object({ kind: z.string() }).safeParse(descendants[0]);

          if (first.success && !policy.first.includes(first.data.kind))
            issue(`Invalid first child for ${definition.name}`, [...path, content.field, 0]);
        }
      }

      if (content.kind === 'text') {
        const text = z.string().safeParse(fields[content.field]);

        if (!text.success) {
          issue('Text field must be a string', [...path, content.field]);

          return null;
        }

        if (content.marks) {
          const raw = z.array(markRange).safeParse(data.data[content.marks] ?? []);
          const ranges: MarkRange[] = [];

          if (!raw.success) issues.push(...prefixed(raw.error.issues, [...path, content.marks]));
          else
            for (const [index, range] of raw.data.entries()) {
              const at = [...path, content.marks, index];
              const mark = registry.get(range.mark.type);

              if (
                !mark ||
                mark.category !== 'mark' ||
                (content.allowedMarks && !content.allowedMarks.includes(mark.name))
              ) {
                issue(`Unsupported mark: ${range.mark.type}`, [...at, 'mark', 'type']);
                continue;
              }

              const markAttrs = attributes(mark, range.mark.attrs, [...at, 'mark', 'attrs']);

              if (!markAttrs) continue;

              try {
                validateTextRange(text.data, range.from, range.to);
                ranges.push({
                  from: range.from,
                  to: range.to,
                  mark: { type: mark.name, attrs: markAttrs.value },
                });
              } catch (error) {
                issue(error instanceof Error ? error.message : String(error), at);
              }
            }

          try {
            fields[content.marks] = normalizeMarks(ranges).map((range) => ({
              ...range,
              mark: { ...range.mark },
            }));
          } catch (error) {
            issue(error instanceof Error ? error.message : String(error), [...path, content.marks]);
          }
        }

        if (content.inline) {
          const raw = z.array(inlineValue).safeParse(data.data[content.inline] ?? []);
          const values: { type: string; id: string; index: number; attrs: JsonValue }[] = [];

          if (!raw.success) issues.push(...prefixed(raw.error.issues, [...path, content.inline]));
          else
            for (const [index, inline] of raw.data.entries()) {
              const at = [...path, content.inline, index];
              const extension = registry.get(inline.type);

              if (
                !extension ||
                extension.category !== 'inline' ||
                (content.allowedInline && !content.allowedInline.includes(extension.name))
              ) {
                issue(`Unsupported inline type: ${inline.type}`, [...at, 'type']);
                continue;
              }

              const inlineAttrs = attributes(extension, inline.attrs, [...at, 'attrs']);

              if (inlineAttrs) values.push({ ...inline, attrs: inlineAttrs.value });
            }

          try {
            validateInlineObjects(text.data, values);
          } catch (error) {
            issue(error instanceof Error ? error.message : String(error), [
              ...path,
              content.inline,
            ]);
          }

          fields[content.inline] = values;
        }
      }

      return fields;
    }

    const nodes = children(input, [], 0);
    const ids = new Set<number>();
    const keys = new Set<string>();

    for (const draft of drafts) {
      if (draft.id !== undefined) {
        if (ids.has(draft.id)) issue('Duplicate node identity', [...draft.path, 'id']);
        ids.add(draft.id);
      }

      if (draft.key !== undefined) {
        if (keys.has(draft.key)) issue('Duplicate node key', [...draft.path, 'key']);
        keys.add(draft.key);
      }
    }

    if (issues.length) return { issues };
    let nextId = -1;

    for (const draft of drafts) {
      while (ids.has(nextId)) nextId--;
      const id = draft.id ?? nextId--;
      ids.add(id);
      draft.fields.id = id;
      draft.fields.key = draft.key ?? crypto.randomUUID();
    }

    freezeJson(nodes);

    return { value: nodes };
  }

  const standard: Omit<
    StandardSchemaV1.Props<
      DocumentInput<readonly SchemaDefinition[]>,
      DocumentOutput<readonly SchemaDefinition[]>
    >,
    'validate'
  > & {
    validate: typeof validate;
  } = { version: 1, vendor: 'gprose', validate: (input) => validate(input) };

  const runtime = compileSchema(definitions);

  return Object.freeze({
    ...runtime,
    definitions: Object.freeze(definitions),
    '~standard': Object.freeze(standard),
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Canonical persisted content is an external validation boundary.
    validateDocument: (input: unknown) => validate(input, true),
  });
}
