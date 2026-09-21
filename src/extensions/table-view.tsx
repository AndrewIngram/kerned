import type {BrowserViewOptions} from '../editor-browser';
import {typography} from './typography';
import {useLayoutEffect,useRef,useState} from 'react';
import {TextSelection,textSelection,type Selection,type SelectionContext,type FindMatch} from '../editor';
import {tableCells} from './table';
import {formattingSpans,type TextFormat} from './formatting';
import type {TableNode,TableCell} from './demo-model';

function CellText({paragraph,matches=[],activeMatch}:{paragraph:TableCell['paragraphs'][number];matches?:readonly FindMatch[];activeMatch?:FindMatch|null}){
  const {text}=paragraph,spans=formattingSpans(paragraph.marks);
  const cuts=[...new Set([0,text.length,...spans.flatMap(s=>[s.start,s.end]),...matches.flatMap(m=>[m.from,m.to])])].sort((a,b)=>a-b);
  const style=paragraph.kind==='heading'?typography(paragraph,18):undefined;
  return <p style={style?{fontSize:style.size,lineHeight:`${style.lineHeight}px`,fontWeight:700}:undefined}>{cuts.slice(0,-1).map((start,index)=>{
    const active=spans.filter(s=>s.start<=start&&s.end>start);
    const match=matches.find(m=>m.from<=start&&m.to>start);
    return <span key={start} data-find-match={match?'true':undefined} data-find-active={match&&match===activeMatch?'true':undefined} style={{fontWeight:active.some(s=>s.bold)?700:undefined,fontStyle:active.some(s=>s.italic)?'italic':undefined,textDecoration:active.some(s=>s.underline)?'underline':undefined}}>{text.slice(start,cuts[index+1])}</span>;
  })}</p>;
}

/** DOM editing surface backed by the same model, selections, and transactions. */
export function TableBlock({findMatches,activeMatch,node,width,onMeasure,selection,context,onSelect,onText,onUndo,onReplace,onFormat,clipboard}:{findMatches?:ReadonlyMap<number,readonly FindMatch[]>;activeMatch?:FindMatch|null;node:TableNode;width:number;onMeasure:(id:number,width:number,height:number)=>void;selection:Selection;context:SelectionContext;onSelect:(selection:Selection)=>void;onText:(id:number,from:number,to:number,text:string,caret:number)=>void;onUndo:(redo:boolean)=>void;onFormat:(key:TextFormat)=>void;onReplace:(text:string)=>void;clipboard:Pick<NonNullable<BrowserViewOptions['input']>,'copy'|'cut'|'paste'>}){
  const [editing,setEditing]=useState<number|null>(null);
  const textRef=useRef<HTMLTextAreaElement>(null);
  const selected=selection instanceof tableCells.CellSelection&&selection.tableId===node.id?new Set(selection.cells(context)):new Set<number>();
  useLayoutEffect(()=>{
    const input=textRef.current;if(!input||!(selection instanceof TextSelection)||selection.head.id!==editing)return;
    input.focus({preventScroll:true});input.setSelectionRange(Math.min(selection.anchor.offset,selection.head.offset),Math.max(selection.anchor.offset,selection.head.offset));
    input.style.height='0px';input.style.height=`${input.scrollHeight}px`;
  },[editing,selection,node]);
  const cellFor=(id:number)=>node.rows.flat().find(cell=>cell.paragraphs.some(p=>p.id===id));
  function selectCell(cell:TableCell,extend:boolean){
    const anchor=extend?(selection instanceof tableCells.CellSelection?selection.anchorCell:selection instanceof TextSelection?cellFor(selection.anchor.id)?.id:undefined):undefined;
    setEditing(null);onSelect(new tableCells.CellSelection(node.id,anchor??cell.id,cell.id));
  }
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(selected.size)ref.current?.focus({preventScroll:true});},[selection,node]);
  useLayoutEffect(()=>{
    const element=ref.current;if(!element)return;
    const measure=()=>onMeasure(node.id,width,element.offsetHeight);
    const observer=new ResizeObserver(measure);observer.observe(element);measure();
    return()=>observer.disconnect();
  },[node.id,width,onMeasure]);
  return <div ref={ref} tabIndex={-1} className="table-block" data-editor-interactive data-table={node.id} onKeyDown={e=>{
    if((e.metaKey||e.ctrlKey)&&['b','i','u'].includes(e.key.toLowerCase())){e.preventDefault();onFormat(e.key.toLowerCase()==='b'?'bold':e.key.toLowerCase()==='i'?'italic':'underline');return;}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();onUndo(e.shiftKey);return;}
    if(selected.size&&(e.key==='Backspace'||e.key==='Delete')){e.preventDefault();onReplace('');}
    if(e.key==='Escape'){setEditing(null);}
  }} onCopy={e=>{if(selected.size)clipboard.copy?.(e.nativeEvent);}} onCut={e=>{if(selected.size)clipboard.cut?.(e.nativeEvent);}} onPaste={e=>clipboard.paste?.(e.nativeEvent)}>
    <table aria-label={node.caption||'Table'} style={{minWidth:Math.max(1,node.rows[0]?.reduce((total,cell)=>total+cell.colspan,0)??1)*100}}>
      {node.caption&&<caption>{node.caption}</caption>}
      <tbody>{node.rows.map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,cellIndex)=>{
        const Cell=cell.header?'th':'td';
        return <Cell key={cell.id} colSpan={cell.colspan} rowSpan={cell.rowspan} data-cell={cell.id} data-selected={selected.has(cell.id)}>
          <button className="cell-selector" aria-label={`Select cell ${rowIndex+1}, ${cellIndex+1}`} onClick={e=>selectCell(cell,e.shiftKey)}>↖</button>
          {cell.paragraphs.map((paragraph,i)=>editing===paragraph.id?<textarea data-text-block={paragraph.id} style={paragraph.kind==='heading'?{fontSize:typography(paragraph,18).size,lineHeight:`${typography(paragraph,18).lineHeight}px`,fontWeight:700}:undefined} ref={textRef} key={paragraph.id} aria-label={`Cell ${rowIndex+1}, ${cellIndex+1} text`} value={paragraph.text} onBlur={e=>{if(e.relatedTarget instanceof HTMLElement&&!ref.current?.contains(e.relatedTarget))setEditing(null);}} onSelect={e=>{
            const el=e.currentTarget;const next=textSelection(paragraph.id,el.selectionStart,el.selectionEnd);if(!selection.eq(next))onSelect(next);
          }} onChange={e=>{
            const value=e.target.value,old=paragraph.text;let from=0;while(from<old.length&&from<value.length&&old[from]===value[from])from++;
            let end=old.length,tail=value.length;while(end>from&&tail>from&&old[end-1]===value[tail-1]){end--;tail--;}
            onText(paragraph.id,from,end,value.slice(from,tail),e.target.selectionStart);
          }} onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();const paragraphs=node.rows.flat().flatMap(c=>c.paragraphs),index=paragraphs.findIndex(p=>p.id===paragraph.id),next=paragraphs[index+(e.shiftKey?-1:1)];if(next){setEditing(next.id);onSelect(textSelection(next.id,0));}}}}/>:<button data-text-block={paragraph.id} className="cell-content" key={paragraph.id} aria-label={`Edit cell ${rowIndex+1}, ${cellIndex+1}${i?`, paragraph ${i+1}`:''}`} onClick={e=>{if(e.shiftKey)selectCell(cell,true);else{setEditing(paragraph.id);onSelect(textSelection(paragraph.id,0));}}}><CellText paragraph={paragraph} matches={findMatches?.get(paragraph.id)} activeMatch={activeMatch}/>{!paragraph.text&&<span className="empty-cell">&nbsp;</span>}</button>)}
        </Cell>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}
