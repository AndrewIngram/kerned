import type { Mark, NodeIdentity, Schema } from '../model';
import type { Step } from '../transform';
import { PermissionDenied } from './permissions';
import type { Selection } from './selection-base';
import type { EditorState, Transaction } from './transactions';

export type ReadContext<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  readonly schema: Schema<N>;
};

export type CommandEdit<N extends NodeIdentity> = {
  readonly steps: readonly Step<N>[];
  readonly selection?: Selection;
  readonly storedMarks?: readonly Mark[] | null;
};

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
  readonly schema: Schema<N>;
  nodeIds(state: EditorState<N>): Iterable<number>;
  readonly state: EditorState<N>;
  preview(state: EditorState<N>, tx: Transaction<N>): EditorState<N>;
  dispatch(tx: Transaction<N>): void;
};

/** Commands see preceding commands' draft state; only run publishes one transaction. */
export function createCommandChain<N extends NodeIdentity>(host: Host<N>, dryRun = false) {
  const initial = host.state,
    time = Date.now(),
    steps: Step<N>[] = [],
    effects: (() => void)[] = [];

  let draft = initial,
    enabled = true,
    finished = false,
    marks: readonly Mark[] | null | undefined;

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

      try {
        const previous = draft.selection;
        draft = host.preview(draft, {
          baseRevision: draft.revision,
          origin: 'local',
          history: 'separate',
          time,
          steps: [...edit.steps],
          selection: edit.selection,
          storedMarks: edit.storedMarks,
        });

        if (edit.storedMarks !== undefined) marks = edit.storedMarks;
        else if (!previous.eq(draft.selection)) marks = undefined;

        for (const step of edit.steps) steps.push(step);
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
        history: 'separate',
        time,
        steps,
        selection: draft.selection,
        storedMarks: marks,
      };

      try {
        if (dryRun) host.preview(initial, tx);
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
