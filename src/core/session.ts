import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  type DocumentInput,
  type DocumentNode,
  type SchemaDefinition,
  type NodeIdentity,
  type Schema,
} from '../model';
import {
  createEditor as createStateEditor,
  selectionContext,
  selectionNear,
  type EditorOptions,
  type EditorState,
  type EditorEvents,
  type Transaction,
  type Command,
  type CommandOptions,
  type Selection,
  type SelectionExtension,
} from '../state';
import {
  commandRegistry,
  type CommandDefinitions,
  type DirectCommands,
  type NamedChain,
  type CommandStateQuery,
} from './commands';
import { queryRegistry, type QueryDefinitions, type NamedQueries } from './queries';
import { createViewEffects, registerViewEffects, type ViewCommands } from './view-effects';

export type ExtensionContext<N extends NodeIdentity> = {
  readonly schema: Schema<N>;
};

export type SessionContribution<N extends NodeIdentity> = {
  commands?: CommandDefinitions<N>;
  queries?: QueryDefinitions<N>;
  fields?: EditorOptions<N>['fields'];
  selections?: readonly SelectionExtension[];
};

type Contribution<Definition> = Definition extends { setup: (...args: never[]) => infer Value }
  ? Value
  : never;

type ValuesOf<Value, Key extends string> = Value extends Record<Key, infer Values> ? Values : never;

type KeysOf<Union> = Union extends Union ? keyof Union : never;

type ValueOf<Union, Key extends PropertyKey> = Union extends Union
  ? Key extends keyof Union
    ? Union[Key]
    : never
  : never;

type Installed<D extends readonly SchemaDefinition[], Key extends string> = {
  [Name in KeysOf<ValuesOf<Contribution<D[number]>, Key>>]: ValueOf<
    ValuesOf<Contribution<D[number]>, Key>,
    Name
  >;
};

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
  ? unknown
  : { incompatibleSessionContribution: never };

type SessionSchema<D extends readonly SchemaDefinition[], N extends NodeIdentity> = Schema<N> & {
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
  permissions?: EditorOptions<N>['permissions'];
} & (
  | { content: DocumentInput<NoInfer<D>>; document?: never }
  | { document: readonly NoInfer<N>[]; content?: never }
);

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
  undo(): boolean;
  redo(): boolean;
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
  config: EditorConfig<D, N> & CompatibleContributions<NoInfer<D>, NoInfer<N>>,
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

  const contributions = schema.definitions.flatMap((definition) => {
    if (!definition.setup) return [];

    // SAFETY: The public construction contract checks every installed setup output
    // against the assembled node type. Model storage deliberately erases behavior types.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The public overload verifies setup accepts this assembled schema and returns compatible session contributions; model stores the erased callback.
    const setup = definition.setup as (
      context: ExtensionContext<DocumentNode<readonly SchemaDefinition[]>>,
    ) => SessionContribution<DocumentNode<readonly SchemaDefinition[]>> | undefined;

    const contribution = setup({ schema });

    return contribution ? [{ ...contribution, name: definition.name }] : [];
  });

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
    },
  );

  const effects = createViewEffects(editor);
  editor.on('destroy', () => effects.destroy());
  const registry = commandRegistry(editor, contributions, effects.commands);

  const session: Editor<readonly SchemaDefinition[], DocumentNode<readonly SchemaDefinition[]>> = {
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
    undo: () => editor.undo() !== null,
    redo: () => editor.redo() !== null,
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

  registerViewEffects(session, effects);

  return session;
}
