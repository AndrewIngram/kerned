import type { StandardSchemaV1 } from '@standard-schema/spec';

import { freezeJson, type Immutable } from './immutable-json';
import { jsonValue, type JsonValue } from './schema-codec';

/** Attribute schemas normalize imported data; they never run on each frame or glyph. */
export type AttributeSchema = StandardSchemaV1<unknown, Readonly<Record<string, JsonValue>>>;

export type TextContent = {
  kind: 'text';
  field: string;
  marks?: string;
  inline?: string;
  allowedMarks?: readonly string[];
  allowedInline?: readonly string[];
  emptySplit?: string;
};

export type ChildContent = {
  kind: 'container';
  field: string;
  /** Nested child arrays support structures such as table rows without adding row nodes. */
  allowed?: readonly string[];
  allowedGroups?: readonly string[];
  minChildren?: number;
  first?: readonly string[];
  firstGroups?: readonly string[];
  /** Only these node types may directly contain this container. */
  parents?: readonly string[];
} & ({ depth?: 1 } | { depth: 2; groupBy: string });

export type NodeSpec = {
  groups?: readonly string[];
  selectable?: boolean;
  attributes: AttributeSchema;
  content: TextContent | ChildContent | { kind: 'atom' };
  /** Optional adapter for an established wire representation; identity and children stay core-owned. */
  persistence?: {
    encode: (data: JsonValue, context: { children: readonly RuntimeDocumentNode[] }) => JsonValue;
    decode: (data: JsonValue, context: { children: readonly RuntimeDocumentNode[] }) => JsonValue;
  };
};

export type MarkSpec = {
  attributes: StandardSchemaV1<unknown, JsonValue>;
  inclusiveStart?: boolean;
  inclusiveEnd?: boolean;
};

export type InlineSpec = {
  attributes: StandardSchemaV1<unknown, JsonValue>;
  plainText: (attributes: JsonValue) => string;
};

type DefinitionOptions = Readonly<Record<string, JsonValue>>;

type DefinitionConfig<Name extends string, Options extends DefinitionOptions, Spec> = {
  name: Name;
  version: number;
  options: Options;
  requires?: readonly string[];
  schema: (options: Immutable<Options>) => Spec;
};

function definition<
  const Category extends 'node' | 'mark' | 'inline',
  const Name extends string,
  Options extends DefinitionOptions,
  Spec extends NodeSpec | MarkSpec | InlineSpec,
>(category: Category, config: DefinitionConfig<Name, Options, Spec>) {
  if (!config.name || !Number.isSafeInteger(config.version) || config.version < 1)
    throw new Error('Extensions require a name and positive schema version');

  // Configuration is data; executable behavior belongs in contributions, not options.
  const options = structuredClone(config.options);
  jsonValue(options);
  const ownedOptions = freezeJson(options);
  const { name, version, schema } = config;
  const requires = Object.freeze([...(config.requires ?? [])]);
  const spec = { ...schema(ownedOptions) };

  // Own declarative metadata without freezing the validator library's internal state.
  if ('content' in spec) {
    if (spec.groups)
      Object.defineProperty(spec, 'groups', { value: Object.freeze([...spec.groups]) });
    const content = { ...spec.content };

    if (content.kind === 'container') {
      if (content.allowed) content.allowed = Object.freeze([...content.allowed]);

      if (content.allowedGroups) content.allowedGroups = Object.freeze([...content.allowedGroups]);

      if (content.first) content.first = Object.freeze([...content.first]);

      if (content.firstGroups) content.firstGroups = Object.freeze([...content.firstGroups]);

      if (content.parents) content.parents = Object.freeze([...content.parents]);
    }

    if (content.kind === 'text') {
      if (content.allowedMarks) content.allowedMarks = Object.freeze([...content.allowedMarks]);

      if (content.allowedInline) content.allowedInline = Object.freeze([...content.allowedInline]);
    }

    Object.freeze(content);
    Object.defineProperty(spec, 'content', { value: content });

    if (spec.persistence)
      Object.defineProperty(spec, 'persistence', { value: Object.freeze({ ...spec.persistence }) });
  }

  Object.freeze(spec);

  return Object.freeze({
    category,
    name,
    version,
    options: ownedOptions,
    requires,
    spec,
    configure(next: Partial<Options>) {
      return definition(category, {
        name,
        version,
        requires,
        schema,
        options: { ...options, ...next },
      });
    },
  });
}

/** Definitions are reusable. Configuring one creates another; no session state lives here. */
export function defineNode<
  const Name extends string,
  Options extends DefinitionOptions,
  const Spec extends NodeSpec,
>(config: DefinitionConfig<Name, Options, Spec>) {
  return definition('node', config);
}

export function defineMark<
  const Name extends string,
  Options extends DefinitionOptions,
  const Spec extends MarkSpec,
>(config: DefinitionConfig<Name, Options, Spec>) {
  return definition('mark', config);
}

export function defineInline<
  const Name extends string,
  Options extends DefinitionOptions,
  const Spec extends InlineSpec,
>(config: DefinitionConfig<Name, Options, Spec>) {
  return definition('inline', config);
}

/** Non-content behavior is retained by assembly and instantiated by each session. */
export function defineExtension<
  const Name extends string,
  Options extends DefinitionOptions,
  Contribution extends object,
>(config: {
  name: Name;
  options: Options;
  requires?: readonly string[];
  setup: (options: Immutable<Options>) => Contribution;
}) {
  if (!config.name) throw new Error('Extensions require a name');
  const { name, setup } = config;
  const options = structuredClone(config.options);
  jsonValue(options);
  const ownedOptions = freezeJson(options);
  const requires = Object.freeze([...(config.requires ?? [])]);

  return Object.freeze({
    category: 'behavior' as const,
    name,
    options: ownedOptions,
    requires,
    setup: () => setup(ownedOptions),
    configure(next: Partial<Options>) {
      return defineExtension({ name, requires, setup, options: { ...options, ...next } });
    },
  });
}

export type SchemaDefinition =
  | { category: 'behavior'; name: string; requires: readonly string[]; setup: () => object }
  | { category: 'node'; name: string; version: number; requires: readonly string[]; spec: NodeSpec }
  | { category: 'mark'; name: string; version: number; requires: readonly string[]; spec: MarkSpec }
  | {
      category: 'inline';
      name: string;
      version: number;
      requires: readonly string[];
      spec: InlineSpec;
    };

type Normalized<Value, Mode extends 'input' | 'output'> = Mode extends 'input'
  ? Value
  : Readonly<Value>;

type Generated<Value, Mode extends 'input' | 'output'> = Mode extends 'input'
  ? Partial<Value>
  : Value;

type AttributeFields<Value> = {
  [Key in keyof Value as Value[Key] extends never ? never : Key]: Value[Key];
};

type Attributes<
  Schema extends StandardSchemaV1,
  Mode extends 'input' | 'output',
> = Mode extends 'input'
  ? StandardSchemaV1.InferInput<Schema>
  : Immutable<StandardSchemaV1.InferOutput<Schema>>;

type Identity<Mode extends 'input' | 'output'> = Mode extends 'input'
  ? { id?: number; key?: string; locked?: boolean }
  : { id: number; key: string; locked?: boolean };

type Sequence<Value, Mode extends 'input' | 'output'> = Mode extends 'input'
  ? Value[]
  : readonly Value[];

type MarkValue<Definition, Mode extends 'input' | 'output'> = Definition extends {
  category: 'mark';
  name: infer Name;
  spec: { attributes: infer Schema extends StandardSchemaV1 };
}
  ? Normalized<{ type: Name; attrs: Attributes<Schema, Mode> }, Mode>
  : never;

type InlineValueOf<Definition, Mode extends 'input' | 'output'> = Definition extends {
  category: 'inline';
  name: infer Name;
  spec: { attributes: infer Schema extends StandardSchemaV1 };
}
  ? Normalized<{ type: Name; id: string; index: number; attrs: Attributes<Schema, Mode> }, Mode>
  : never;

type Allowed<Value, Content, Key extends string> =
  Content extends Record<Key, readonly string[]>
    ? Extract<Value, { type: Content[Key][number] }>
    : Value;

type TextFields<
  Content,
  All extends readonly SchemaDefinition[],
  Mode extends 'input' | 'output',
> = (Content extends { marks: infer Field extends string }
  ? {
      [Key in Field]: Sequence<
        Normalized<
          {
            from: number;
            to: number;
            mark: Allowed<MarkValue<All[number], Mode>, Content, 'allowedMarks'>;
          },
          Mode
        >,
        Mode
      >;
    }
  : {}) &
  (Content extends { inline: infer Field extends string }
    ? {
        [Key in Field]: Sequence<
          Allowed<InlineValueOf<All[number], Mode>, Content, 'allowedInline'>,
          Mode
        >;
      }
    : {});

type AllowedDefinition<Definition, Content> = Definition extends {
  category: 'node';
  name: infer Name;
  spec: infer Spec;
}
  ? Content extends { allowed: readonly string[] } | { allowedGroups: readonly string[] }
    ?
        | (Content extends { allowed: readonly string[] }
            ? Name extends Content['allowed'][number]
              ? Definition
              : never
            : never)
        | (Content extends { allowedGroups: readonly string[] }
            ? Spec extends { groups: readonly string[] }
              ? Extract<Spec['groups'][number], Content['allowedGroups'][number]> extends never
                ? never
                : Definition
              : never
            : never)
    : Definition
  : never;

type Children<
  Content,
  All extends readonly SchemaDefinition[],
  Mode extends 'input' | 'output',
> = Normalized<Identity<Mode>, Mode> &
  NodeValue<AllowedDefinition<All[number], Content>, All, Mode>;

interface ChildNodes<
  Content,
  All extends readonly SchemaDefinition[],
  Mode extends 'input' | 'output',
> extends ReadonlyArray<Children<Content, All, Mode>> {}

type ContentFields<
  Content,
  All extends readonly SchemaDefinition[],
  Mode extends 'input' | 'output',
> = Content extends { kind: 'container'; field: infer Field extends string }
  ? {
      [Key in Field]: Content extends { depth: 2 }
        ? readonly ChildNodes<Content, All, Mode>[]
        : ChildNodes<Content, All, Mode>;
    }
  : Content extends { kind: 'text' }
    ? TextFields<Content, All, Mode>
    : {};

type NodeValue<
  Definition,
  All extends readonly SchemaDefinition[],
  Mode extends 'input' | 'output',
> = Definition extends { category: 'node'; name: infer Name; spec: infer Spec extends NodeSpec }
  ? Normalized<
      { kind: Name } & AttributeFields<Attributes<Spec['attributes'], Mode>> &
        Generated<ContentFields<Spec['content'], All, Mode>, Mode>,
      Mode
    >
  : never;

/** Recursive node unions derive from installed definitions, including custom child storage. */
type ImmutableJson =
  | null
  | boolean
  | number
  | string
  | readonly ImmutableJson[]
  | { readonly [key: string]: ImmutableJson | undefined };

export type RuntimeDocumentNode = Readonly<{
  id: number;
  key: string;
  kind: string;
  locked?: boolean;
  [field: string]: ImmutableJson | undefined;
}>;

export type DocumentNode<
  All extends readonly SchemaDefinition[],
  Mode extends 'input' | 'output' = 'output',
> = Normalized<Identity<Mode>, Mode> &
  (string extends All[number]['name']
    ? Mode extends 'input'
      ? { kind: string; [field: string]: JsonValue | undefined }
      : RuntimeDocumentNode
    : NodeValue<All[number], All, Mode>);

export type DocumentInput<All extends readonly SchemaDefinition[]> = DocumentNode<All, 'input'>[];

export type DocumentOutput<All extends readonly SchemaDefinition[]> = readonly DocumentNode<All>[];

export type DocumentMark<
  Definitions extends readonly SchemaDefinition[],
  Mode extends 'input' | 'output' = 'output',
> = MarkValue<Definitions[number], Mode>;

export type DocumentInline<
  Definitions extends readonly SchemaDefinition[],
  Mode extends 'input' | 'output' = 'output',
> = InlineValueOf<Definitions[number], Mode>;
