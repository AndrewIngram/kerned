import {useRef,useLayoutEffect} from 'react';
import type {ChecklistNode} from './demo-model';

export function Checklist({node,width,onChange,onMeasure}:{node:ChecklistNode;width:number;onChange:(node:ChecklistNode)=>void;onMeasure:(id:number,width:number,height:number)=>void}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const element=ref.current;

if(!element)return;
    const observer=new ResizeObserver(()=>onMeasure(node.id,width,element.offsetHeight));observer.observe(element);
    onMeasure(node.id,width,element.offsetHeight);

return()=>observer.disconnect();
  },[node.id,width,onMeasure]);

  return <div ref={ref} className="checklist" data-widget={node.id}>
    <div className="checklist-heading"><strong>Review checklist</strong><small>{node.checked.filter(Boolean).length} of 3 complete</small></div>
    {['Confirm the outline','Review the examples','Check the final wording'].map((label,i)=><label key={label}><input type="checkbox" checked={node.checked[i]} onChange={e=>onChange({...node,checked:node.checked.map((v,n)=>n===i?e.target.checked:v)})}/>{label}</label>)}
    <button aria-expanded={node.expanded} onClick={()=>onChange({...node,expanded:!node.expanded})}>{node.expanded?'Hide block notes':'Add block notes'}</button>
    {node.expanded&&<label className="notes-label">Block notes<textarea value={node.notes} onChange={e=>onChange({...node,notes:e.target.value})} placeholder="What needs attention?"/></label>}
  </div>;
}
