import type { Mark, NodeIdentity, Schema } from '../model';
import type { Step } from '../transform';
import { PermissionDenied } from './permissions';
import { TextSelection } from './selection';
import type { Selection } from './selection-base';
import { inputMarks } from './stored-marks';
import type { EditorState, Transaction } from './transactions';

export type ReadContext<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  readonly schema: Schema<N>;
};

export type CommandOptions = {
  readonly history?: 'separate' | { group: string };
  readonly time?: number;
};

export type CommandEdit<N extends NodeIdentity> = {
  readonly steps: readonly Step<N>[];
} & (
  | { readonly input: true; readonly selection: TextSelection; readonly storedMarks?: never }
  | {
      readonly input?: false;
      readonly selection?: Selection;
      readonly storedMarks?: readonly Mark[] | null;
    }
);

export type CommandContext<N extends NodeIdentity> = ReadContext<N> & {
  allocate(this: void): NodeIdentity;
  /** Nested commands share this draft. A false result aborts the entire chain. */
  command<Args extends unknown[]>(
    command: Command<N, Args> | CommandDefinition<N, Args>,
    ...args: Args
  ): boolean;
  /** Apply content and its resulting selection as one draft transition. */
  apply(edit: CommandEdit<N>): void;
  step(step: Step<N>): void;
  steps(steps: readonly Step<N>[]): void;
  select(selection: Selection): void;
  /** Queued until successful publication. Never runs in can(). */
  effect(effect: () => void): void;
  storedMarks(marks: readonly Mark[] | null): void;
  /** Replay occupies this chain's edit slot; view effects may accompany it. */
  restoreHistory(direction: 'undo' | 'redo'): boolean;
};

export type Command<N extends NodeIdentity, Args extends unknown[] = []> = (
  context: CommandContext<N>,
  ...args: Args
) => boolean;

export type CommandActivity = 'active' | 'inactive' | 'mixed';

export type CommandDefinition<N extends NodeIdentity, Args extends unknown[] = []> = {
  execute: Command<N, Args>;
  activity?: (context: ReadContext<N>, ...args: Args) => CommandActivity;
};

export type CommandState = { available: boolean; activity: CommandActivity };

/** Empty selections have no active value; callers choose which nodes/ranges participate. */
export function commandActivity(values: Iterable<boolean>): CommandActivity {
  let yes = false,
    no = false;

  for (const value of values) {
    if (value) yes = true;
    else no = true;

    if (yes && no) return 'mixed';
  }

  return yes ? 'active' : 'inactive';
}

type Host<N extends NodeIdentity> = {
  assertActive(): void;
  readonly schema: Schema<N>;
  nodeIds(state: EditorState<N>): Iterable<number>;
  readonly state: EditorState<N>;
  preview(state: EditorState<N>, tx: Transaction<N>): EditorState<N>;
  dispatch(tx: Transaction<N>): void;
  prepareHistory(direction: 'undo' | 'redo'): {
    readonly state: EditorState<N>;
    run(dryRun: boolean): boolean;
  } | null;
};

/** Commands see preceding commands' draft state; only run publishes one transaction. */
export function createCommandChain<N extends NodeIdentity>(
  host: Host<N>,
  dryRun = false,
  options: CommandOptions = {},
) {
  const initial = host.state,
    time = options.time ?? Date.now(),
    history =
      options.history && options.history !== 'separate'
        ? { group: options.history.group }
        : 'separate',
    steps: Step<N>[] = [],
    effects: (() => void)[] = [];

  let draft = initial,
    enabled = true,
    finished = false,
    marks: readonly Mark[] | null | undefined;

  let replay: ReturnType<Host<N>['prepareHistory']> = null;

  let allocationNodes: readonly N[] | undefined;
  let occupiedIds = new Set<number>();
  const reserved = new Set<number>();
  let nextId = -1;

  function allocate(): NodeIdentity {
    open();

    if (!enabled) throw new Error('Cannot allocate from a failed command draft');

    if (allocationNodes !== draft.nodes) {
      occupiedIds = new Set(host.nodeIds(draft));
      allocationNodes = draft.nodes;
    }

    while (occupiedIds.has(nextId) || reserved.has(nextId)) nextId--;
    const id = nextId--;
    reserved.add(id);

    return { id, key: crypto.randomUUID() };
  }

  function open() {
    host.assertActive();

    if (finished) throw new Error('Command chain already completed');
  }

  const chain = {
    get state() {
      return draft;
    },
    effect(this: void, effect: () => void) {
      open();

      if (enabled) effects.push(effect);

      return chain;
    },
    apply(this: void, edit: CommandEdit<N>) {
      open();

      if (!enabled) return chain;

      if (replay) {
        enabled = false;

        return chain;
      }

      try {
        if (
          edit.input &&
          (edit.selection.anchor.id !== edit.selection.head.id ||
            edit.selection.anchor.offset !== edit.selection.head.offset)
        )
          throw new Error('Input edits require a caret selection');
        const insertionMarks = edit.input ? inputMarks(host.schema, draft) : undefined;
        const storedMarks = insertionMarks ?? edit.storedMarks;

        const batch = insertionMarks
          ? edit.steps.map((step) =>
              step.kind === 'replaceText' || step.kind === 'replaceRanges'
                ? { ...step, marks: step.marks ?? insertionMarks }
                : step,
            )
          : edit.steps;

        const previous = draft.selection;
        draft = host.preview(draft, {
          baseRevision: draft.revision,
          origin: 'local',
          history,
          time,
          steps: [...batch],
          selection: edit.selection,
          storedMarks,
        });

        if (storedMarks !== undefined) marks = storedMarks;
        else if (!previous.eq(draft.selection)) marks = undefined;

        for (const step of batch) steps.push(step);
      } catch (error) {
        enabled = false;

        if (!(error instanceof PermissionDenied)) throw error;
      }

      return chain;
    },
    storedMarks(this: void, value: readonly Mark[] | null) {
      return chain.apply({ steps: [], storedMarks: value });
    },
    step(this: void, step: Step<N>) {
      return chain.apply({ steps: [step] });
    },
    steps(this: void, batch: readonly Step<N>[]) {
      return chain.apply({ steps: batch });
    },
    select(this: void, selection: Selection) {
      return chain.apply({ steps: [], selection });
    },
    command<Args extends unknown[]>(
      command: Command<N, Args> | CommandDefinition<N, Args>,
      ...args: Args
    ) {
      execute(command, ...args);

      return chain;
    },
    run() {
      open();
      finished = true;

      if (!enabled || host.state !== initial) return false;

      const tx: Transaction<N> = {
        baseRevision: initial.revision,
        origin: 'local',
        history,
        time,
        steps,
        selection: draft.selection,
        storedMarks: marks,
      };

      try {
        if (replay) {
          if (!replay.run(dryRun)) return false;
        } else if (dryRun) host.preview(initial, tx);
        else if (steps.length || !draft.selection.eq(initial.selection) || marks !== undefined)
          host.dispatch(tx);

        if (!dryRun)
          for (const effect of effects) {
            try {
              effect();
            } catch (error) {
              queueMicrotask(() => {
                throw error;
              });
            }
          }

        return true;
      } catch (error) {
        if (error instanceof PermissionDenied) return false;
        throw error;
      }
    },
  };

  const context: CommandContext<N> = {
    schema: host.schema,
    allocate,
    get state() {
      return draft;
    },
    command: execute,
    apply: chain.apply,
    step: chain.step,
    steps: chain.steps,
    select: chain.select,
    effect: chain.effect,
    storedMarks: chain.storedMarks,
    restoreHistory(direction) {
      open();

      if (!enabled) return false;

      if (replay || steps.length || !draft.selection.eq(initial.selection) || marks !== undefined) {
        enabled = false;

        return false;
      }

      replay = host.prepareHistory(direction);

      if (!replay) {
        enabled = false;

        return false;
      }

      draft = replay.state;

      return true;
    },
  };

  function execute<Args extends unknown[]>(
    command: Command<N, Args> | CommandDefinition<N, Args>,
    ...args: Args
  ): boolean {
    open();

    if (!enabled) return false;

    try {
      if (!('execute' in command ? command.execute : command)(context, ...args)) enabled = false;
    } catch (error) {
      enabled = false;

      if (!(error instanceof PermissionDenied)) throw error;
    }

    return enabled;
  }

  return chain;
}
