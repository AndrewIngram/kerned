import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  type DocumentInput,
  type DocumentNode,
  type SchemaDefinition,
  type NodeIdentity,
  type Schema,
  type SchemaValues,
  type DefinitionContribution,
} from '../model';
import {
  createEditor as createStateEditor,
  selectionContext,
  selectionNear,
  type EditorOptions as StateEditorOptions,
  type EditorState,
  type EditorEvents,
  type Transaction,
  type Command,
  type CommandOptions,
  type Selection,
  type SelectionExtension,
  type HistoryOptions,
} from '../state';
import {
  commandRegistry,
  type CommandDefinitions,
  type DirectCommands,
  type NamedChain,
  type CommandStateQuery,
} from './commands';
import { createContributions, type ContributionContext } from './contributions';
import { createExtensionLifetime } from './extension-lifetime';
import { queryRegistry, type QueryDefinitions, type NamedQueries } from './queries';
import { createViewEffects, registerViewEffects, type ViewCommands } from './view-effects';

export type ExtensionContext<N extends NodeIdentity> = ContributionContext & {
  readonly schema: Schema<N>;
  /** Register resource cleanup immediately; late registrations clean up at once. */
  onDestroy(this: void, cleanup: () => void): void;
};

export type SessionContribution<N extends NodeIdentity> = {
  commands?: CommandDefinitions<N>;
  queries?: QueryDefinitions<N>;
  fields?: StateEditorOptions<N>['fields'];
  selections?: readonly SelectionExtension[];
  history?: HistoryOptions;
};

type ValuesOf<Value, Key extends string> = Value extends Value
  ? Key extends keyof Value
    ? NonNullable<Value[Key]>
    : never
  : never;

type KeysOf<Union> = Union extends Union ? keyof Union : never;

type ValueOf<Union, Key extends PropertyKey> = Union extends Union
  ? Key extends keyof Union
    ? Union[Key]
    : never
  : never;

type Capabilities<Value, Key extends string> = {
  [Name in KeysOf<ValuesOf<Value, Key>>]: ValueOf<ValuesOf<Value, Key>, Name>;
};

// An array can be empty; only a tuple proves its definitions are installed.
type Installed<
  D extends readonly SchemaDefinition[],
  Key extends string,
> = number extends D['length'] ? {} : Capabilities<DefinitionContribution<D[number]>, Key>;

type IsUnion<Value, Whole = Value> = Value extends Whole
  ? [Whole] extends [Value]
    ? false
    : true
  : never;

type UnstableCapability<Value, Key extends string> = keyof Capabilities<Value, Key> extends never
  ? never
  : Exclude<keyof Capabilities<Value, Key>, string> extends never
    ? string extends keyof Capabilities<Value, Key>
      ? Key
      : [Value] extends [Record<Key, Required<Capabilities<Value, Key>>>]
        ? {
            [Name in keyof Capabilities<Value, Key>]: true extends IsUnion<
              Capabilities<Value, Key>[Name]
            >
              ? Name
              : never;
          }[keyof Capabilities<Value, Key>]
        : Key
    : Key;

// Check each assembly slot before distributing definition unions: either branch must
// install the same callable capabilities. Availability belongs in command execution.
type UnstableContributions<D extends readonly SchemaDefinition[]> = {
  [Index in keyof D]:
    | UnstableCapability<DefinitionContribution<D[Index]>, 'commands'>
    | UnstableCapability<DefinitionContribution<D[Index]>, 'queries'>;
}[number];

type InvalidContribution<Definition, N extends NodeIdentity> = Definition extends {
  setup: (...args: never[]) => object | undefined;
}
  ? Definition['setup'] extends (context: ExtensionContext<N>) => SessionContribution<N> | undefined
    ? never
    : Definition
  : never;

type CompatibleContributions<D extends readonly SchemaDefinition[], N extends NodeIdentity> = [
  InvalidContribution<D[number], N>,
] extends [never]
  ? [UnstableContributions<D>] extends [never]
    ? unknown
    : { readonly sessionCapabilitiesMustBeStable: never }
  : { incompatibleSessionContribution: never };

type SessionSchema<D extends readonly SchemaDefinition[], N extends NodeIdentity> = Schema<N> &
  SchemaValues<D> & {
    readonly definitions: D;
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Canonical document validation accepts external persisted content.
    readonly validateDocument: (input: unknown) => StandardSchemaV1.Result<readonly N[]>;
    readonly '~standard': {
      readonly version: 1;
      readonly vendor: string;
      readonly types?: { readonly input: DocumentInput<D>; readonly output: readonly N[] };
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Standard Schema accepts unknown content at its validation boundary.
      validate(input: unknown): StandardSchemaV1.Result<readonly N[]>;
    };
  };

type EditorConfig<D extends readonly SchemaDefinition[], N extends NodeIdentity> = {
  schema: SessionSchema<D, N>;
  selection?: Selection;
  documentId?: string;
  revision?: number;
  positionCheckpoint?: unknown;
  permissions?: StateEditorOptions<N>['permissions'];
} & (
  | { content: DocumentInput<NoInfer<D>>; document?: never }
  | { document: readonly NoInfer<N>[]; content?: never }
);

/** Configuration accepted by the headless constructor and framework ownership adapters. */
export type EditorOptions<
  D extends readonly SchemaDefinition[],
  N extends NodeIdentity,
> = EditorConfig<D, N> & CompatibleContributions<NoInfer<D>, NoInfer<N>>;

type StateSession<N extends NodeIdentity> = ReturnType<typeof createStateEditor<N>>;

export type Editor<D extends readonly SchemaDefinition[], N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  readonly schema: SessionSchema<D, N>;
  readonly documentId: string;
  readonly history: { undo: number; redo: number };
  readonly commands: DirectCommands<Installed<D, 'commands'> & ViewCommands, N>;
  readonly queries: NamedQueries<Installed<D, 'queries'>>;
  readonly getCommandState: CommandStateQuery<Installed<D, 'commands'> & ViewCommands, N>;
  chain(options?: CommandOptions): NamedChain<Installed<D, 'commands'> & ViewCommands, N>;
  can(): DirectCommands<Installed<D, 'commands'> & ViewCommands, N> & {
    chain(options?: CommandOptions): NamedChain<Installed<D, 'commands'> & ViewCommands, N>;
  };
  dispatch(transaction: Transaction<N>): ReturnType<StateSession<N>['dispatch']>;
  readonly positions: StateSession<N>['positions'];
  readonly journal: StateSession<N>['journal'];
  readonly find: StateSession<N>['find'];
  breakHistory(this: void): void;
  allocateBlockId(): number;
  selectionEdit(text: string): ReturnType<StateSession<N>['selectionEdit']>;
  setStoredMarks: StateSession<N>['setStoredMarks'];
  transact(command: Command<N>, options?: CommandOptions): boolean;
  select(this: void, selection: Selection): void;
  subscribe(this: void, listener: () => void): () => void;
  on<Key extends keyof EditorEvents<N>>(
    name: Key,
    listener: (event: EditorEvents<N>[Key]) => void,
  ): () => void;
  readonly isDestroyed: boolean;
  destroy(): void;
};

/** Content and installed capabilities come from one compiled extension assembly. */
export function createEditor<const D extends readonly SchemaDefinition[], N extends NodeIdentity>(
  config: EditorOptions<D, N>,
): Editor<D, N>;
export function createEditor(
  config: EditorConfig<readonly SchemaDefinition[], DocumentNode<readonly SchemaDefinition[]>>,
): Editor<readonly SchemaDefinition[], DocumentNode<readonly SchemaDefinition[]>> {
  const { schema } = config;

  const result =
    config.document === undefined
      ? schema['~standard'].validate(config.content)
      : schema.validateDocument(config.document);

  if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join('; '));

  const lifetime = createExtensionLifetime();
  const adapters = createContributions(lifetime.onDestroy);

  try {
    const contributions = schema.definitions.flatMap((definition) => {
      if (!definition.setup) return [];

      // SAFETY: The public construction contract checks every installed setup output
      // against the assembled node type. Model storage deliberately erases behavior types.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The public overload verifies setup accepts this assembled schema and returns compatible session contributions; model stores the erased callback.
      const setup = definition.setup as (
        context: ExtensionContext<DocumentNode<readonly SchemaDefinition[]>>,
      ) => SessionContribution<DocumentNode<readonly SchemaDefinition[]>> | undefined;

      const contribution = setup({
        schema,
        onDestroy: lifetime.onDestroy,
        provide: adapters.context.provide,
      });

      return contribution ? [{ ...contribution, name: definition.name }] : [];
    });

    const historyProviders = contributions.filter((contribution) => contribution.history);

    if (historyProviders.length > 1)
      throw new Error(
        `Conflicting history providers: ${historyProviders.map((provider) => provider.name).join(', ')}`,
      );

    const content = [...result.value];

    const editor = createStateEditor(
      schema,
      content,
      config.selection ?? selectionNear(selectionContext(schema, content)),
      contributions.flatMap((contribution) => contribution.selections ?? []),
      {
        documentId: config.documentId,
        revision: config.revision,
        positionCheckpoint: config.positionCheckpoint,
        permissions: config.permissions,
        fields: contributions.flatMap((contribution) => contribution.fields ?? []),
        history: historyProviders[0]?.history ?? null,
      },
    );

    const effects = createViewEffects(editor);
    editor.on('destroy', () => effects.destroy());
    editor.on('destroy', () => {
      adapters.dispose();
      lifetime.dispose();
    });
    const registry = commandRegistry(editor, contributions, effects.commands);

    const session: Editor<
      readonly SchemaDefinition[],
      DocumentNode<readonly SchemaDefinition[]>
    > = {
      documentId: editor.documentId,
      positions: editor.positions,
      get journal() {
        return editor.journal;
      },
      find: editor.find,
      breakHistory: () => editor.breakHistory(),
      allocateBlockId: () => editor.allocateBlockId(),
      selectionEdit: (text: string) => editor.selectionEdit(text),
      setStoredMarks: (marks) => editor.setStoredMarks(marks),
      dispatch: (transaction: Transaction<DocumentNode<readonly SchemaDefinition[]>>) => {
        return editor.dispatch(transaction);
      },
      transact: (
        command: Command<DocumentNode<readonly SchemaDefinition[]>>,
        options?: CommandOptions,
      ) => editor.chain(options).command(command).run(),
      select: (selection: Selection) => {
        editor.select(selection);
      },
      subscribe: (listener: () => void) => editor.subscribe(listener),
      on: editor.on,
      destroy: () => editor.destroy(),
      get isDestroyed() {
        return editor.isDestroyed;
      },
      get state() {
        return editor.state;
      },
      get history() {
        return editor.history;
      },
      schema,
      commands: registry.direct(),
      getCommandState: registry.state,
      queries: queryRegistry(() => ({ state: editor.state, schema }), contributions),
      chain(options?: CommandOptions) {
        return registry.chain(false, options);
      },
      can() {
        return {
          ...registry.direct(true),
          chain: (options?: CommandOptions) => registry.chain(true, options),
        };
      },
    };

    adapters.attach(session);
    registerViewEffects(session, effects);

    return session;
  } catch (error) {
    adapters.dispose();

    try {
      lifetime.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Editor initialization and extension cleanup failed',
        { cause: cleanupError },
      );
    }

    throw error;
  }
}
