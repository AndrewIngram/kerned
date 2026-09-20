import {TextSelection,indexTree,type NodeIdentity,type Schema,type EditorState} from '../editor';

type InputSession<N extends NodeIdentity>={readonly state:EditorState<N>;breakHistory():void};
/** Native textarea capture independent of React, schema names and rendering. */
export function createTextInput<N extends NodeIdentity>(schema:Schema<N>,editor:InputSession<N>){
  let capture={value:'',offset:0},composing=false,frame=0;
  function sync(input:HTMLTextAreaElement){
    const {selection,nodes}=editor.state;
    if(!(selection instanceof TextSelection))return;
    const tree=indexTree(schema,nodes),{anchor,head}=selection;
    if(anchor.id!==head.id){
      const a=tree.order.findIndex(entry=>entry.node.id===anchor.id),b=tree.order.findIndex(entry=>entry.node.id===head.id);
      input.value='';input.setSelectionRange(0,0);capture={value:'',offset:(a<b?anchor:head).offset};
    }else{
      const node=tree.byId.get(head.id)?.node,text=node?schema.text(node):null;
      if(text===null)return;
      input.value=text;input.setSelectionRange(Math.min(anchor.offset,head.offset),Math.max(anchor.offset,head.offset));capture={value:text,offset:0};
    }
  }
  return {
    get composing(){return composing;},
    sync,
    compositionStart(){editor.breakHistory();composing=true;},
    compositionEnd(input:HTMLTextAreaElement|null){composing=false;editor.breakHistory();cancelAnimationFrame(frame);if(input)frame=requestAnimationFrame(()=>sync(input));},
    read(input:HTMLTextAreaElement,replace:(from:number,to:number,text:string)=>void){
      const selection=editor.state.selection;if(!(selection instanceof TextSelection))return;
      const value=input.value,old=capture.value,offset=capture.offset,{anchor,head}=selection;
      capture={value,offset};
      if(anchor.id===head.id&&anchor.offset!==head.offset){
        const start=Math.min(anchor.offset,head.offset),end=Math.max(anchor.offset,head.offset);
        replace(start,end,value.slice(start,value.length-(old.length-end)));return;
      }
      let from=0;while(from<old.length&&from<value.length&&old[from]===value[from])from++;
      let to=old.length,end=value.length;while(to>from&&end>from&&old[to-1]===value[end-1]){to--;end--;}
      replace(offset+from,offset+to,value.slice(from,end));
    },
    /** Observe Safari's native Select All, which can bypass keydown. */
    mount(input:HTMLTextAreaElement,onSelectAll:()=>void){
      const select=()=>{
        const selection=editor.state.selection;
        if(composing||!input.value||input.selectionStart!==0||input.selectionEnd!==input.value.length||!(selection instanceof TextSelection)||selection.anchor.id!==selection.head.id)return;
        if(Math.min(selection.anchor.offset,selection.head.offset)===0&&Math.max(selection.anchor.offset,selection.head.offset)===input.value.length)return;
        onSelectAll();
      };
      input.addEventListener('select',select);
      return ()=>{input.removeEventListener('select',select);cancelAnimationFrame(frame);composing=false;};
    },
  };
}
