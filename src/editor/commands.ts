import type {NodeIdentity} from './schema';
import type {EditorState, Step, Transaction} from './transactions';
import type {Selection} from './selection';
import {PermissionDenied} from './permissions';
import type {Mark} from './marks';

export type CommandContext<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  step(step: Step<N>): void;
  steps(steps: readonly Step<N>[]): void;
  select(selection: Selection): void;
  /** Queued until successful publication. Never runs in can(). */
  effect(effect:()=>void):void;
  storedMarks(marks:readonly Mark[]|null):void;
};
export type Command<N extends NodeIdentity, Args extends unknown[] = []> = (context: CommandContext<N>, ...args: Args) => boolean;
export type CommandActivity='active'|'inactive'|'mixed';
export type CommandDefinition<N extends NodeIdentity,Args extends unknown[]=[]>={
  execute:Command<N,Args>;
  activity?:(state:EditorState<N>,...args:Args)=>CommandActivity;
};
export type CommandState={available:boolean;activity:CommandActivity};
/** Empty selections have no active value; callers choose which nodes/ranges participate. */
export function commandActivity(values:Iterable<boolean>):CommandActivity{
  let yes=false,no=false;
  for(const value of values){if(value)yes=true;else no=true;if(yes&&no)return 'mixed';}
  return yes?'active':'inactive';
}
type Host<N extends NodeIdentity> = {
  readonly state: EditorState<N>;
  preview(state: EditorState<N>, tx: Transaction<N>): EditorState<N>;
  dispatch(tx: Transaction<N>): unknown;
};
/** Commands see preceding commands' draft state; only run publishes one transaction. */
export function createCommandChain<N extends NodeIdentity>(host: Host<N>, dryRun = false) {
  const initial = host.state, steps: Step<N>[] = [],effects:(()=>void)[]=[];
  let draft = initial, enabled = true, finished = false,marks:readonly Mark[]|null|undefined;
  function open() {if (finished) throw new Error('Command chain already completed');}
  const chain = {
    get state() {return draft;},
    effect(effect:()=>void){open();if(enabled)effects.push(effect);return chain;},
    storedMarks(value:readonly Mark[]|null){
      open();if(!enabled)return chain;
      try{draft=host.preview(draft,{baseRevision:draft.revision,origin:'local',history:'separate',time:0,steps:[],storedMarks:value});marks=value;}
      catch(error){if(error instanceof PermissionDenied)enabled=false;else throw error;}
      return chain;
    },
    step(step: Step<N>) {return chain.steps([step]);},
    steps(batch: readonly Step<N>[]) {
      open(); if (!enabled) return chain;
      try {
        const previous=draft.selection;
        draft = host.preview(draft, {baseRevision: draft.revision, origin: 'local', history: 'separate', time: 0, steps: [...batch]});
        if(!previous.eq(draft.selection))marks=undefined;
        for (const step of batch) steps.push(step);
      } catch (error) {if (error instanceof PermissionDenied) enabled = false; else throw error;}
      return chain;
    },
    select(selection: Selection) {
      open(); if (!enabled) return chain;
      const previous=draft.selection;
      draft = host.preview(draft, {baseRevision: draft.revision, origin: 'local', history: 'separate', time: 0, steps: [], selection});
      if(!previous.eq(selection))marks=undefined;
      return chain;
    },
    command<Args extends unknown[]>(command: Command<N, Args>|CommandDefinition<N,Args>, ...args: Args) {
      open(); if (enabled && !(typeof command==='function'?command:command.execute)(chain, ...args)) enabled = false;
      return chain;
    },
    run() {
      open(); finished = true;
      if (!enabled || host.state !== initial) return false;
      const tx: Transaction<N> = {baseRevision: initial.revision, origin: 'local', history: 'separate', time: Date.now(), steps, selection: draft.selection,storedMarks:marks};
      try {
        if (dryRun) host.preview(initial, tx);
        else if (steps.length || !draft.selection.eq(initial.selection)||marks!==undefined) host.dispatch(tx);
        if(!dryRun)for(const effect of effects){try{effect();}catch(error){queueMicrotask(()=>{throw error;});}}
        return true;
      } catch (error) {if (error instanceof PermissionDenied) return false; throw error;}
    },
  };
  return chain;
}
