import type {NodeIdentity,Schema} from './schema';
import type {EditorState,Step} from './transactions';
import {selectionContext} from './selection';
import {indexTree,type TreeIndex} from './tree';
import {hasMark,removeMark,setMark,type Mark} from './marks';

export type MarkChange={kind:'set';mark:Mark}|{kind:'remove';type:string}|{kind:'clear'};

function selected<N extends NodeIdentity>(schema:Schema<N>,state:EditorState<N>,tree:TreeIndex<N>){
  return state.selection.ranges(selectionContext(schema,state.nodes,tree)).flatMap(range=>{
    const node=tree.byId.get(range.id)?.node;

if(!node||range.kind!=='text'||range.from===range.to)return [];
    const extension=schema.resolve(node),marks=extension.kind==='text'?extension.editing.marks:undefined;

    return marks?[{node,marks,from:range.from,to:range.to}]:[];
  });
}

export function selectionHasMark<N extends NodeIdentity>(schema:Schema<N>,state:EditorState<N>,mark:Mark,tree=indexTree(schema,state.nodes)){
  const ranges=selected(schema,state,tree);

  return ranges.length>0&&ranges.every(({node,marks,from,to})=>hasMark(marks.read(node),from,to,mark));
}

/** Ordinary update steps retain the editor's permission, transaction and undo rules. */
export function changeSelectionMarks<N extends NodeIdentity>(schema:Schema<N>,state:EditorState<N>,change:MarkChange,tree=indexTree(schema,state.nodes)):Step<N>[]{
  const changes=new Map<number,N>();

  for(const {node,marks,from,to} of selected(schema,state,tree)){
    const current=changes.get(node.id)??node,ranges=marks.read(current);
    const updated=change.kind==='set'?setMark(ranges,from,to,change.mark):removeMark(ranges,from,to,change.kind==='remove'?change.type:undefined);
    changes.set(node.id,marks.write(current,updated));
  }

  return [...changes.values()].map(node=>({kind:'updateBlock',node}));
}
