import {selectionContext,TextSelection,AllSelection,type createEditor,type Schema,type NodeIdentity,type RelativeRange,type InlineDecoration} from '../editor';

/** The discussion owns its identity; the document never registers its range. */
export type CommentThread<Message> = Readonly<{id:string;range:RelativeRange;messages:readonly Message[]}>;
export function commentDecorations<Message>(threads:readonly CommentThread<Message>[]):InlineDecoration<CommentThread<Message>>[]{
  return threads.map(thread=>({id:thread.id,range:thread.range,data:thread}));
}
export function captureComment<N extends NodeIdentity,Message>(schema:Schema<N>,editor:Pick<ReturnType<typeof createEditor<N>>,'state'|'positions'>,id:string,messages:readonly Message[]):CommentThread<Message>|null{
  const {state}=editor;
  if(!(state.selection instanceof TextSelection)&&!(state.selection instanceof AllSelection))return null;
  const ranges=state.selection.ranges(selectionContext(schema,state.nodes)).filter(range=>range.kind==='text'&&range.from<range.to);
  const first=ranges[0],last=ranges.at(-1);
  if(!first||first.kind!=='text'||!last||last.kind!=='text')return null;
  return {id,messages,range:editor.positions.range(editor.positions.at(first.id,first.from,1),editor.positions.at(last.id,last.to,-1))};
}

/** Feature state has its own persistence and observation, independent of text undo. */
export function createCommentStore<Message>(initial:readonly CommentThread<Message>[]=[]){
  let state=Object.freeze({threads:Object.freeze([...initial])});
  const listeners=new Set<()=>void>();
  function publish(threads:readonly CommentThread<Message>[]){
    state=Object.freeze({threads:Object.freeze([...threads])});
    for(const listener of [...listeners]){try{listener();}catch(error){queueMicrotask(()=>{throw error;});}}
  }
  function putAll(threads:readonly CommentThread<Message>[]){
    if(!threads.length)return;
    const merged=new Map(state.threads.map(thread=>[thread.id,thread]));
    for(const thread of threads)merged.set(thread.id,thread);
    publish([...merged.values()]);
  }
  return {
    get state(){return state;},
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    put(thread:CommentThread<Message>){putAll([thread]);},
    putAll,
    remove(id:string){if(state.threads.some(t=>t.id===id))publish(state.threads.filter(t=>t.id!==id));},
  };
}
