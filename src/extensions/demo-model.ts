import {boundaries,type Span} from '../model';
import {replaceInlineObjects,inlinePlainText} from '../editor';
import {createMention,mention,type Mention} from './mention';
import {comment,type Comment} from './comment';
export type HybridSpan = Span & {underline?:boolean};
export type HeadingLevel = 1|2|3|4;
export type TextBlockNode = ({kind:'paragraph'}|{kind:'heading';level:HeadingLevel}) & {id:number;key:string;text:string;spans:HybridSpan[];atoms:Mention[];comments:Comment[]};
export type ChecklistNode = {kind:'checklist';id:number;key:string;checked:boolean[];expanded:boolean;notes:string};
export type ImageNode = {kind:'image';id:number;key:string;src:string;alt:string};
export type TableCell = {kind:'tableCell';id:number;key:string;row:number;header:boolean;colspan:number;rowspan:number;paragraphs:TextBlockNode[]};
export type TableNode = {kind:'table';id:number;key:string;caption:string;rows:TableCell[][]};
export type HybridLeaf = TextBlockNode | ChecklistNode | ImageNode | TableNode;
export type QuoteNode={kind:'quote';id:number;key:string;children:HybridNode[]};
export type ListNode={kind:'list';id:number;key:string;ordered:boolean;start:number;children:HybridNode[]};
export type ListItemNode={kind:'listItem';id:number;key:string;children:HybridNode[]};
export type HybridNode = HybridLeaf | QuoteNode | ListNode | ListItemNode | TableCell;
export function createHybridDocument():HybridNode[]{
  const first='Review the draft with \ufffc before sharing it with the team.';
  const second='We should keep the first release focused and gather feedback before expanding the scope.';
  const nodes:HybridNode[]=[
    {kind:'paragraph',id:1,key:'block-1',text:first,spans:[],atoms:[createMention({id:'maya',index:first.indexOf('\ufffc'),label:'@Maya Chen',width:132,ascent:23,descent:7})],comments:[]},
    {kind:'paragraph',id:2,key:'block-2',text:second,spans:[],atoms:[],comments:[{id:'review',start:10,end:40,data:{reply:''}}]},
    {kind:'checklist',id:3,key:'block-3',checked:[true,false,false],expanded:false,notes:''},
    {kind:'paragraph',id:4,key:'block-4',text:'The checklist stays part of the document. The next paragraph moves when its content expands.',spans:[],atoms:[],comments:[]},
  ];
  for(let i=0;i<160;i++)nodes.push(i%12===0?{kind:'checklist',id:i+10,key:`block-${i+10}`,checked:[false,false,false],expanded:false,notes:''}:{kind:'paragraph',id:i+10,key:`block-${i+10}`,text:`Section ${i+1}. Canvas text keeps its own wrapping and caret geometry. Scroll to see only nearby interactive blocks mount.`,spans:[],atoms:[],comments:[]});
  return nodes;
}
export function replaceText(node:TextBlockNode,from:number,to:number,value:string):TextBlockNode{
  const delta=value.length-(to-from);
  const atoms=replaceInlineObjects(node.atoms,from,to,value.length);
  const comments=comment.replace(node.comments,from,to,value.length);
  const text=node.text.slice(0,from)+value+node.text.slice(to);
  const stops=boundaries(text);
  const spans=node.spans.flatMap(span=>{
    if(to<=span.start)return [{...span,start:span.start+delta,end:span.end+delta}];
    if(from>=span.end)return [span];
    // Keep the unaffected parts of formatting around a replaced range.
    const start=Math.min(span.start,from),end=Math.max(from+value.length,span.end+delta);
    return start<end?[{...span,start,end}]:[];
  });
  // A combining mark typed at a style edge belongs to its complete grapheme.
  const formatted=spans.map(span=>({...span,start:[...stops].reverse().find(p=>p<=span.start)??0,end:stops.find(p=>p>=span.end)??text.length}));
  return {...node,text,atoms,comments,spans:formatted};
}
export function plainText(node:TextBlockNode,from=0,to=node.text.length){
  return inlinePlainText(node.text,node.atoms,from,to,mention.plainText);
}
