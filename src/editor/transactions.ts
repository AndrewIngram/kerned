import {type PositionMap} from './positions';
import {indexTree,validateTree,childrenAt,spliceChildren,type TreeIndex} from './tree';
import {invertAnchorMap,type AnchorMap,type RevisionMap} from './anchors';
import {validateTextRange} from './text';
import {createFind} from './find';
import {replaceRanges} from './replace-ranges';
import type {NodeIdentity,Schema} from './schema';
import {Selection,selectionContext,selectionMapping,createSelectionRegistry,type SelectionExtension,type SelectionBookmark,type SelectionRange} from './selection';

export type Step<N extends NodeIdentity> =
  | {kind:'replaceText';id:number;from:number;to:number;text:string}
  | {kind:'replaceRanges';ranges:readonly SelectionRange[];text:string;pruneEmpty:readonly number[]}
  | {kind:'split';id:number;at:number;rightId:number;rightKey:string}
  | {kind:'join';left:number;right:number}
  | {kind:'updateBlock';node:N}
  | {kind:'append';nodes:N[]}
  | {kind:'insertChildren';parent:number|null;index:number;nodes:N[]}
  | {kind:'replaceChildren';parent:number|null;index:number;count:number;nodes:N[]}
  | {kind:'removeChildren';parent:number|null;index:number;count:number}
  | {kind:'moveChildren';parent:number|null;index:number;count:number;toParent:number|null;toIndex:number}
  | {kind:'wrapChildren';parent:number|null;index:number;count:number;wrapper:N}
  | {kind:'unwrap';id:number};
export type Transaction<N extends NodeIdentity> = {baseRevision:number;steps:readonly Step<N>[];selection?:Selection} & (
  | {origin:'local';history:'separate'|{group:string};time:number}
  | {origin:'stream';history:'exclude'}
);
export type EditorState<N extends NodeIdentity> = {nodes:N[];selection:Selection;revision:number};
type Change<N extends NodeIdentity> = {index:number;before:N[];after:N[]};
type Applied<N extends NodeIdentity> = {state:EditorState<N>;changes:Change<N>[];maps:PositionMap[];anchorMaps:AnchorMap[];changedIds:number[]};
type HistoryEntry<N extends NodeIdentity> = {changes:Change<N>[];maps:AnchorMap[];before:SelectionBookmark;after:SelectionBookmark;afterSelection:Selection;group:string|null;time:number};

export function applyTransaction<N extends NodeIdentity>(schema:Schema<N>,state:EditorState<N>,tx:Transaction<N>,selections=createSelectionRegistry()):Applied<N>{
  if(tx.baseRevision!==state.revision)throw new Error('Stale transaction: rebase before applying');
  let nodes=state.nodes;
  const indexes=new WeakMap<readonly N[],TreeIndex<N>>();
  function treeFor(value:readonly N[]){let tree=indexes.get(value);if(!tree){tree=indexTree(schema,value);indexes.set(value,tree);}return tree;}
  function splice(value:N[],parent:number|null,index:number,count:number,inserted:readonly N[]){return spliceChildren(schema,value,parent,index,count,inserted,treeFor(value));}
  const changes:Change<N>[]=[],maps:PositionMap[]=[],anchorMaps:AnchorMap[]=[],changedIds=new Set<number>();
  function publish(next:N[],structural:boolean){
    const oldTree=treeFor(nodes),newTree=treeFor(next);
    let start=0,end=nodes.length,nextEnd=next.length;
    while(start<end&&start<nextEnd&&nodes[start]===next[start])start++;
    while(end>start&&nextEnd>start&&nodes[end-1]===next[nextEnd-1]){end--;nextEnd--;}
    if(start===end&&start===nextEnd)return;
    changes.push({index:start,before:nodes.slice(start,end),after:next.slice(start,nextEnd)});
    for(const [id,entry] of oldTree.byId)if(newTree.byId.get(id)?.node!==entry.node)changedIds.add(id);
    for(const [id,entry] of newTree.byId)if(oldTree.byId.get(id)?.node!==entry.node)changedIds.add(id);
    if(structural){
      for(const [key,entry] of oldTree.byKey){const nextEntry=newTree.byKey.get(key);
        if(nextEntry&&(nextEntry.node.id!==entry.node.id||schema.text(nextEntry.node)!==schema.text(entry.node)))throw new Error('Structural changes must preserve surviving text and identities');
      }
      for(const [id,entry] of oldTree.byId){const nextEntry=newTree.byId.get(id);if(nextEntry&&nextEntry.node.key!==entry.node.key)throw new Error('Structural changes cannot reuse an existing handle for a different key');}
      const removed=[...oldTree.byKey.keys()].filter(key=>!newTree.byKey.has(key)),inserted=[...newTree.byKey.keys()].filter(key=>!oldTree.byKey.has(key));
      if(removed.length)anchorMaps.push({kind:'remove',keys:removed});
      if(inserted.length)anchorMaps.push({kind:'insert',keys:inserted});
    }
    nodes=next;
  }
  for(let stepIndex=0;stepIndex<tx.steps.length;stepIndex++){
    const step=tx.steps[stepIndex];
    if(tx.origin==='stream'&&step.kind!=='append')throw new Error('Stream transactions may only append blocks');
    if(step.kind==='updateBlock'){
      // Property edits leave paths and identities intact. Validate consecutive
      // updates in order, then copy the affected branches and publish once.
      const tree=treeFor(nodes),updated=new Map<number,N>(),dirtyAncestors=new Set<number>();
      function currentNode(original:N):N{
        let node=updated.get(original.id)??original;
        if(dirtyAncestors.delete(node.id)){
          node=schema.withChildren(node,schema.children(node).map(currentNode));
          updated.set(node.id,node);
        }
        return node;
      }
      for(;stepIndex<tx.steps.length;stepIndex++){
        const update=tx.steps[stepIndex];if(update.kind!=='updateBlock')break;
        const entry=tree.byId.get(update.node.id);if(!entry)throw new Error('Missing block');
        const node=currentNode(entry.node);
        if(update.node.key!==node.key)throw new Error('Property updates cannot change identity');
        schema.validateUpdate(node,update.node);
        if(schema.text(node)!==schema.text(update.node))throw new Error('Property updates cannot change editable text');
        const oldChildren=schema.children(node),newChildren=schema.children(update.node);
        if(oldChildren.length!==newChildren.length||oldChildren.some((child,i)=>child!==newChildren[i]))throw new Error('Property updates cannot change children');
        if(node===update.node)continue;
        updated.set(node.id,update.node);
        for(let parent=entry.parent;parent!==null;){
          dirtyAncestors.add(parent);
          const ancestor=tree.byId.get(parent);if(!ancestor)throw new Error('Missing ancestor');
          parent=ancestor.parent;
        }
      }
      stepIndex--;
      if(updated.size)publish(nodes.map(currentNode),false);
      continue;
    }
    if(step.kind==='append'){
      if(tx.origin!=='stream')throw new Error('Append belongs to the loading stream');
      const next=nodes.concat(step.nodes);treeFor(next);
      nodes=next;for(const {node} of treeFor(step.nodes).order)changedIds.add(node.id);continue;
    }
    if(step.kind==='replaceRanges'){
      const before=treeFor(nodes),result=replaceRanges(schema,nodes,before,step.ranges,step.text,step.pruneEmpty),after=treeFor(result.nodes);
      const removed=[...before.byKey.keys()].filter(key=>!after.byKey.has(key)&&!result.joinedKeys.has(key));
      if(removed.length)anchorMaps.push({kind:'remove',keys:removed});
      maps.push(...result.maps);anchorMaps.push(...result.anchorMaps);
      publish(result.nodes,false);continue;
    }
    if(step.kind==='insertChildren'){publish(splice(nodes,step.parent,step.index,0,step.nodes),true);continue;}
    if(step.kind==='replaceChildren'){publish(splice(nodes,step.parent,step.index,step.count,step.nodes),true);continue;}
    if(step.kind==='removeChildren'){publish(splice(nodes,step.parent,step.index,step.count,[]),true);continue;}
    if(step.kind==='moveChildren'){
      const children=childrenAt(schema,nodes,step.parent,treeFor(nodes)),moving=children.slice(step.index,step.index+step.count);
      if(step.count<1)throw new Error('Move requires at least one child');
      if(step.toParent!==null&&treeFor(moving).byId.has(step.toParent))throw new Error('Cannot move a node into its own subtree');
      const removed=splice(nodes,step.parent,step.index,step.count,[]);
      publish(splice(removed,step.toParent,step.toIndex,0,moving),true);continue;
    }
    if(step.kind==='wrapChildren'){
      const children=childrenAt(schema,nodes,step.parent,treeFor(nodes));
      if(step.count<1||schema.resolve(step.wrapper).kind!=='container'||schema.children(step.wrapper).length)throw new Error('Wrap requires an empty container and nonempty child range');
      if(treeFor(nodes).byId.has(step.wrapper.id)||treeFor(nodes).byKey.has(step.wrapper.key))throw new Error('Duplicate wrapper identity');
      const wrapper=schema.withChildren(step.wrapper,children.slice(step.index,step.index+step.count));
      publish(splice(nodes,step.parent,step.index,step.count,[wrapper]),true);continue;
    }
    if(step.kind==='unwrap'){
      const entry=treeFor(nodes).byId.get(step.id);
      if(!entry||schema.resolve(entry.node).kind!=='container')throw new Error('Unwrap requires a container');
      publish(splice(nodes,entry.parent,entry.index,1,schema.children(entry.node)),true);continue;
    }
    let before:N[]=[],after:N[]=[],map:PositionMap|undefined,anchorMap:AnchorMap|undefined;
    const id=step.kind==='join'?step.left:step.id;
    const entry=treeFor(nodes).byId.get(id);if(!entry)throw new Error('Missing block');
    const node=entry.node;before=[node];
    switch(step.kind){
      case 'replaceText':{
        const editing=schema.editing(node);validateTextRange(editing.text(node),step.from,step.to);
        const next=editing.replace(node,step.from,step.to,step.text);
        if(next.id!==node.id||next.key!==node.key||schema.text(next)!==editing.text(node).slice(0,step.from)+step.text+editing.text(node).slice(step.to))throw new Error('Text extension violated replacement contract');
        after=[next];map={kind:'replace',id,from:step.from,to:step.to,inserted:step.text.length};anchorMap={kind:'replace',key:node.key,from:step.from,to:step.to,inserted:step.text.length};break;
      }
      case 'split':{
        const editing=schema.editing(node);validateTextRange(editing.text(node),step.at,step.at);
        if(treeFor(nodes).byId.has(step.rightId)||treeFor(nodes).byKey.has(step.rightKey))throw new Error('Duplicate block ID');
        after=editing.split(node,step.at,{id:step.rightId,key:step.rightKey});
        if(after[0].id!==node.id||after[0].key!==node.key||after[1].id!==step.rightId||after[1].key!==step.rightKey||schema.text(after[0])!==editing.text(node).slice(0,step.at)||schema.text(after[1])!==editing.text(node).slice(step.at))throw new Error('Text extension violated split contract');
        map={kind:'split',id,at:step.at,rightId:step.rightId};anchorMap={kind:'split',key:node.key,at:step.at,rightKey:step.rightKey};break;
      }
      case 'join':{
        const left=node,right=childrenAt(schema,nodes,entry.parent,treeFor(nodes))[entry.index+1];
        if(!right||right.id!==step.right)throw new Error('Only adjacent text blocks can join');
        const editing=schema.editing(left),at=editing.text(left).length;
        const next=editing.join(left,right);
        if(next.id!==left.id||next.key!==left.key||schema.text(next)!==editing.text(left)+schema.editing(right).text(right))throw new Error('Text extension violated join contract');
        validateTextRange(schema.editing(next).text(next),at,at);
        after=[next];before=[left,right];map={kind:'join',left:id,right:right.id,at};anchorMap={kind:'join',key:node.key,rightKey:right.key,at};break;
      }
    }
    if(before.length===after.length&&before.every((n,i)=>n===after[i]))continue;
    after.forEach(schema.resolve);
    publish(splice(nodes,entry.parent,entry.index,before.length,after),false);
    if(map)maps.push(map);
    if(anchorMap)anchorMaps.push(anchorMap);
  }
  const tree=validateTree(schema,nodes,treeFor(nodes));
  const context=selectionContext(schema,nodes,tree);
  const selection=tx.selection??state.selection.map(context,selectionMapping(selectionContext(schema,state.nodes,treeFor(state.nodes)),context,maps));
  selections.validate(context,selection);
  return {state:{nodes,selection,revision:state.revision+1},changes,maps,anchorMaps,changedIds:[...changedIds]};
}


/** Local history only. A collaboration adapter must rebase operations and history;
 * stale transactions are rejected rather than silently replayed over newer state. */
export function createEditor<N extends NodeIdentity>(schema:Schema<N>,initial:N[],selection:Selection,extensions:readonly SelectionExtension[]=[]){
  const selections=createSelectionRegistry(extensions);
  validateTree(schema,initial);selections.validate(selectionContext(schema,initial),selection);
  let state:EditorState<N>={nodes:initial,selection,revision:0},nextId=-1;
  let allocationNodes:readonly N[]|undefined;
  let occupiedIds:ReadonlySet<number>=new Set();
  const past:HistoryEntry<N>[]=[],future:HistoryEntry<N>[]=[],journal:RevisionMap[]=[];
  let boundary=true;
  function restore(redo:boolean){
    const source=redo?future:past,target=redo?past:future,entry=source.at(-1);
    if(!entry)return null;
    let nodes=state.nodes;const changedIds=new Set<number>();
    for(const change of redo?entry.changes:[...entry.changes].reverse()){
      const expected=redo?change.before:change.after,replacement=redo?change.after:change.before;
      const index=expected.length?nodes.findIndex(n=>n.id===expected[0].id):change.index;
      if(index<0||index>nodes.length||expected.some((n,i)=>nodes[index+i]!==n))throw new Error('History needs rebasing before this action can be undone');
      nodes=[...nodes.slice(0,index),...replacement,...nodes.slice(index+expected.length)];
      for(const n of [...expected,...replacement])changedIds.add(n.id);
    }
    validateTree(schema,nodes);const context=selectionContext(schema,nodes),nextSelection=(redo?entry.after:entry.before).resolve(context);selections.validate(context,nextSelection);
    source.pop();target.push(entry);boundary=true;
    journal.push({from:state.revision,to:state.revision+1,maps:redo?entry.maps:[...entry.maps].reverse().map(invertAnchorMap)});
    state={nodes,selection:nextSelection,revision:state.revision+1};
    return {state,changedIds:[...changedIds]};
  }
  return {
    get state(){return state;},
    find:createFind(schema,()=>state.nodes),
    get journal():readonly RevisionMap[]{return journal;},
    get history(){return {undo:past.length,redo:future.length};},
    allocateBlockId(){
      // A paste allocates thousands of identities before publishing any nodes.
      // Scan once per immutable document, including externally inserted IDs.
      if(allocationNodes!==state.nodes){occupiedIds=new Set(indexTree(schema,state.nodes).byId.keys());allocationNodes=state.nodes;}
      while(occupiedIds.has(nextId))nextId--;
      return nextId--;
    },
    breakHistory(){boundary=true;},
    selectionJSON(){return state.selection.encode(selectionContext(schema,state.nodes));},
    readSelection(value:unknown){return selections.read(selectionContext(schema,state.nodes),value);},
    selectionEdit(text:string){return state.selection.replace(selectionContext(schema,state.nodes),text);},
    select(next:Selection){selections.validate(selectionContext(schema,state.nodes),next);if(!state.selection.eq(next))boundary=true;state={...state,selection:next};return state;},
    dispatch(tx:Transaction<N>){
      const result=applyTransaction(schema,state,tx,selections);
      if(tx.origin==='local'&&result.changes.length){
        const group=tx.history==='separate'?null:tx.history.group,last=past.at(-1);
        if(!boundary&&group!==null&&last?.group===group&&tx.time>=last.time&&(group.startsWith('composition:')||tx.time-last.time<750)&&last.afterSelection.eq(state.selection)){
          last.changes.push(...result.changes);last.maps.push(...result.anchorMaps);last.after=result.state.selection.getBookmark();last.afterSelection=result.state.selection;last.time=tx.time;
        }else{past.push({changes:[...result.changes],maps:[...result.anchorMaps],before:state.selection.getBookmark(),after:result.state.selection.getBookmark(),afterSelection:result.state.selection,group,time:tx.time});if(past.length>256)past.shift();}
        future.length=0;boundary=group===null;
      }
      journal.push({from:state.revision,to:result.state.revision,maps:result.anchorMaps});
      state=result.state;return result;
    },
    undo:()=>restore(false),redo:()=>restore(true),
  };
}
