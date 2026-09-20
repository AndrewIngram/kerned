import {indexTree,TextSelection,textSelection,type EditorState,type NodeIdentity,type Schema,type Step} from '../editor';
import {replaceStructuredText} from './blocks';
import type {HybridNode} from './demo-model';

/** Plain-text clipboard paragraphs, inserted together as one undoable transaction. */
export function pasteParagraphs(schema:Schema<HybridNode>,state:EditorState<HybridNode>,text:string,allocate:()=>NodeIdentity){
  const lines=text.split('\n');
  const replacement=replaceStructuredText(schema,state,lines[0]);
  if(lines.length===1)return replacement;
  const caret=replacement.selection;
  if(!(caret instanceof TextSelection))throw new Error('Text replacement must return a caret');
  const entry=indexTree(schema,state.nodes).byId.get(caret.head.id);
  if(!entry)throw new Error('Missing paste destination');
  const tail=allocate(),last=lines[lines.length-1];
  const middle:HybridNode[]=lines.slice(1,-1).map(text=>({kind:'paragraph',...allocate(),text,marks:[],inline:[]}));
  const steps:Step<HybridNode>[]=[...replacement.steps,
    {kind:'split',id:caret.head.id,at:caret.head.offset,rightId:tail.id,rightKey:tail.key},
    {kind:'replaceText',id:tail.id,from:0,to:0,text:last},
  ];
  if(middle.length)steps.push({kind:'insertChildren',parent:entry.parent,index:entry.index+1,nodes:middle});
  return {steps,selection:textSelection(tail.id,last.length)};
}
