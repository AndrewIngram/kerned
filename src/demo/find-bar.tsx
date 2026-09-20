import {useId,useLayoutEffect,useRef,useState} from 'react';
import type {FindOptions,FindState} from '../editor';

export function FindIcon(){
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>;
}

/** The demo owns presentation and focus. The editor owns matching and navigation. */
export function FindBar({state,initialQuery,initialOptions,stale,focusRequest,onQuery,onMove,onClose}:{
  state:FindState;initialQuery:string;initialOptions:FindOptions;stale:boolean;focusRequest:number;
  onQuery:(query:string,options:FindOptions)=>void;
  onMove:(backwards:boolean)=>void;onClose:()=>void;
}){
  const input=useRef<HTMLInputElement>(null),statusId=useId();
  // Input state is urgent and local. Publishing results never rewrites a newer draft.
  const [query,setQuery]=useState(initialQuery),[matchCase,setMatchCase]=useState(initialOptions.matchCase);
  const pending=stale||query!==state.query||matchCase!==state.matchCase;
  useLayoutEffect(()=>{input.current?.focus({preventScroll:true});input.current?.select();},[focusRequest]);
  const count=state.matches.length;
  return <div className="find-bar" role="search" aria-label="Find in document" onKeyDown={event=>{
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
    if(event.key==='Enter'&&event.target===input.current){event.preventDefault();if(!pending)onMove(event.shiftKey);}
  }}>
    <input ref={input} type="text" aria-label="Find in document" aria-describedby={statusId} placeholder="Find in document" value={query} spellCheck={false} autoComplete="off" onChange={event=>{setQuery(event.target.value);onQuery(event.target.value,{matchCase});}}/>
    <output id={statusId} className="find-count" aria-live="polite" aria-atomic="true" aria-busy={pending}>{pending?'…':!query?'':count?`${state.activeIndex+1} of ${count}`:'No results'}</output>
    <button type="button" aria-label="Match case" title="Match case" aria-pressed={matchCase} onMouseDown={event=>event.preventDefault()} onClick={()=>{input.current?.focus({preventScroll:true});setMatchCase(!matchCase);onQuery(query,{matchCase:!matchCase});}}>Aa</button>
    <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={pending||!count} onMouseDown={event=>event.preventDefault()} onClick={()=>{input.current?.focus({preventScroll:true});onMove(true);}}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6 14 6-6 6 6"/></svg></button>
    <button type="button" aria-label="Next match" title="Next match (Enter)" disabled={pending||!count} onMouseDown={event=>event.preventDefault()} onClick={()=>{input.current?.focus({preventScroll:true});onMove(false);}}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6 10 6 6 6-6"/></svg></button>
    <button type="button" aria-label="Close find" title="Close find (Escape)" onClick={onClose}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
  </div>;
}
