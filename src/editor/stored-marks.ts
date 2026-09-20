import type {NodeIdentity,Schema} from './schema';
import type {EditorState} from './transactions';
import {TextSelection} from './selection';
import {indexTree} from './tree';
import {boundaries} from './text';
import {removeMark,setMark,type Mark} from './marks';

/** Left-side formatting wins at a boundary; document start uses the right side. */
export function marksAt<N extends NodeIdentity>(schema:Schema<N>,node:N,offset:number,side:'left'|'right'='left'):Mark[]{
  const extension=schema.resolve(node),adapter=extension.kind==='text'?extension.editing.marks:undefined;
  const marks:Mark[]=[];
  for(const range of adapter?.read(node)??[]){
    const included=side==='right'?range.from<=offset&&range.to>offset
      :range.from<offset&&range.to>offset||range.from===offset&&(adapter?.boundary?.(range.mark,'start')??offset===0)
        ||range.to===offset&&(adapter?.boundary?.(range.mark,'end')??true);
    if(included&&!marks.some(mark=>mark.type===range.mark.type))marks.push(range.mark);
  }
  return marks;
}
export function inputMarks<N extends NodeIdentity>(schema:Schema<N>,state:EditorState<N>,tree=indexTree(schema,state.nodes)):readonly Mark[]{
  if(state.storedMarks!=null)return state.storedMarks;
  if(!(state.selection instanceof TextSelection))return [];
  const {anchor,head}=state.selection;
  if(anchor.id===head.id){const node=tree.byId.get(anchor.id)?.node;return node?marksAt(schema,node,Math.min(anchor.offset,head.offset),anchor.offset===head.offset?'left':'right'):[];}
  const order=tree.order,ai=order.findIndex(entry=>entry.node.id===anchor.id),hi=order.findIndex(entry=>entry.node.id===head.id);
  const point=ai<hi||ai===hi&&anchor.offset<head.offset?anchor:head,node=tree.byId.get(point.id)?.node;
  return node?marksAt(schema,node,point.offset,anchor.id===head.id&&anchor.offset===head.offset?'left':'right'):[];
}
export function markInsertedText<N extends NodeIdentity>(schema:Schema<N>,node:N,from:number,length:number,marks:readonly Mark[]):N{
  if(!length)return node;
  const extension=schema.resolve(node);if(extension.kind!=='text'||!extension.editing.marks)return node;
  const adapter=extension.editing.marks,stops=boundaries(extension.editing.text(node));
  const start=[...stops].reverse().find(offset=>offset<=from)??0,end=stops.find(offset=>offset>=from+length)??from+length;
  let ranges=removeMark(adapter.read(node),start,end);
  for(const mark of marks)ranges=setMark(ranges,start,end,mark);
  return adapter.write(node,ranges);
}
