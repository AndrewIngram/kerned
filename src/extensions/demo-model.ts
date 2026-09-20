import {boundaries,type Span} from '../model';
import {replaceInlineObjects,type InlineValue,type MarkRange,type NodeIdentity} from '../editor';
import {createMention,inlineSchema} from './mention';
export type HybridSpan = Span & {underline?:boolean};
export type HeadingLevel = 1|2|3|4;
export type TextBlockNode = ({kind:'paragraph'}|{kind:'heading';level:HeadingLevel}) & NodeIdentity & {text:string;marks:MarkRange[];inline:InlineValue[]};
export type ChecklistNode = NodeIdentity & {kind:'checklist';checked:boolean[];expanded:boolean;notes:string};
export type ImageNode = NodeIdentity & {kind:'image';src:string;alt:string};
export type TableCell = NodeIdentity & {kind:'tableCell';row:number;header:boolean;colspan:number;rowspan:number;paragraphs:TextBlockNode[]};
export type TableNode = NodeIdentity & {kind:'table';caption:string;rows:TableCell[][]};
export type HybridLeaf = TextBlockNode | ChecklistNode | ImageNode | TableNode;
export type QuoteNode= NodeIdentity & {kind:'quote';children:HybridNode[]};
export type ListNode= NodeIdentity & {kind:'list';ordered:boolean;start:number;children:HybridNode[]};
export type ListItemNode= NodeIdentity & {kind:'listItem';children:HybridNode[]};
export type HybridNode = HybridLeaf | QuoteNode | ListNode | ListItemNode | TableCell;
export function createHybridDocument():HybridNode[]{
  const first='Review the draft with \ufffc before sharing it with the team.';
  const second='We should keep the first release focused and gather feedback before expanding the scope.';
  const nodes:HybridNode[]=[
    {kind:'paragraph',id:1,key:'block-1',text:first,marks:[],inline:[createMention({id:'maya',index:first.indexOf('\ufffc'),label:'@Maya Chen',width:132,ascent:23,descent:7})]},
    {kind:'paragraph',id:2,key:'block-2',text:second,marks:[],inline:[]},
    {kind:'checklist',id:3,key:'block-3',checked:[true,false,false],expanded:false,notes:''},
    {kind:'paragraph',id:4,key:'block-4',text:'The checklist stays part of the document. The next paragraph moves when its content expands.',marks:[],inline:[]},
  ];
  for(let i=0;i<160;i++)nodes.push(i%12===0?{kind:'checklist',id:i+10,key:`block-${i+10}`,checked:[false,false,false],expanded:false,notes:''}:{kind:'paragraph',id:i+10,key:`block-${i+10}`,text:`Section ${i+1}. Canvas text keeps its own wrapping and caret geometry. Scroll to see only nearby interactive blocks mount.`,marks:[],inline:[]});
  return nodes;
}
export function replaceText(node:TextBlockNode,from:number,to:number,value:string):TextBlockNode{
  const delta=value.length-(to-from);
  const inline=replaceInlineObjects(node.inline,from,to,value.length);
  const text=node.text.slice(0,from)+value+node.text.slice(to);
  const stops=boundaries(text);
  const spans=node.marks.flatMap(span=>{
    if(to<=span.from)return [{...span,from:span.from+delta,to:span.to+delta}];
    if(from>=span.to)return [span];
    // Keep the unaffected parts of formatting around a replaced range.
    const start=Math.min(span.from,from),end=Math.max(from+value.length,span.to+delta);
    return start<end?[{...span,from:start,to:end}]:[];
  });
  // A combining mark typed at a style edge belongs to its complete grapheme.
  const formatted=spans.map(span=>({...span,from:[...stops].reverse().find(p=>p<=span.from)??0,to:stops.find(p=>p>=span.to)??text.length}));
  return {...node,text,inline,marks:formatted};
}
export function plainText(node:TextBlockNode,from=0,to=node.text.length){
  const labels=new Map(node.inline.map(value=>[value.index,inlineSchema.plainText(value)]));
  let result='';for(let i=from;i<to;i++)result+=labels.get(i)??node.text[i];return result;
}
