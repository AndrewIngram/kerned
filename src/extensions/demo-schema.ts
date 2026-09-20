import {formattingMarks,formattingSpans,formattingSchema} from './formatting';
import {demoCodecs} from './demo-codecs';
import {createDocumentCodec,createSchema,validateInlineObjects,sliceInlineObjects,type NodeExtension} from '../editor';
import {replaceText,type HybridNode,type TextBlockNode} from './demo-model';
import {editableTableExtension,tableCellExtension} from './table';
import {listCommands,quoteExtension} from './blocks';
function textBlock(node:HybridNode):TextBlockNode{
  if((node.kind!=='paragraph'&&node.kind!=='heading'))throw new Error('Text extension requires a paragraph or heading');return node;
}
function slice(node:TextBlockNode,from:number,to:number,id=node.id):TextBlockNode{
  return {...node,id,text:node.text.slice(from,to),
    spans:node.spans.flatMap(s=>s.end>from&&s.start<to?[{...s,start:Math.max(s.start,from)-from,end:Math.min(s.end,to)-from}]:[]),
    atoms:sliceInlineObjects(node.atoms,from,to)};
}
function joined(left:TextBlockNode,right:TextBlockNode):TextBlockNode{
  const offset=left.text.length;
  const spans=[...left.spans];
  for(const s of right.spans){
    const shifted={...s,start:s.start+offset,end:s.end+offset},same=spans.findIndex(v=>v.end===shifted.start&&v.bold===s.bold&&v.italic===s.italic&&!!v.underline===!!s.underline);
    if(same>=0)spans[same]={...spans[same],end:shifted.end};else spans.push(shifted);
  }
  return {...left,text:left.text+right.text,spans,atoms:[...left.atoms,...right.atoms.map(a=>({...a,index:a.index+offset}))]};
}

export const paragraphExtension:NodeExtension<HybridNode>={
  name:'paragraph',version:1,kind:'text',accepts:node=>node.kind==='paragraph',
  validateUpdate(before,after){
    const a=textBlock(before),b=textBlock(after);
    if(a.text!==b.text||a.atoms!==b.atoms)throw new Error('Text and inline objects require explicit editing operations');
    for(const span of b.spans)if(!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.end> b.text.length||span.start>=span.end)throw new Error('Invalid formatting range');
  },
  editing:{
    text:node=>textBlock(node).text,
    marks:{validate:marks=>marks.map(mark=>formattingSchema.create(mark.type,mark.attrs)),read:node=>formattingMarks(textBlock(node).spans),write(node,marks){const text=textBlock(node);return {...text,spans:formattingSpans(formattingSchema.validate(text.text,marks))};}},
    replace(node,from,to,text){const next=replaceText(textBlock(node),from,to,text);validateInlineObjects(next.text,next.atoms);return next;},
    split(node,at,right){const p=textBlock(node);const tail={...slice(p,at,p.text.length,right.id),key:right.key};return [slice(p,0,at),at===p.text.length?{kind:'paragraph',id:tail.id,key:tail.key,locked:tail.locked,text:tail.text,spans:tail.spans,atoms:tail.atoms}:tail];},
    join:(left,right)=>joined(textBlock(left),textBlock(right)),
  },
};
export const headingExtension:NodeExtension<HybridNode>={...paragraphExtension,name:'heading',accepts:node=>node.kind==='heading'};
export const checklistExtension:NodeExtension<HybridNode>={name:'checklist',version:1,kind:'atom',accepts:node=>node.kind==='checklist',validateUpdate(){}};
export const imageExtension:NodeExtension<HybridNode>={name:'image',version:1,kind:'atom',accepts:node=>node.kind==='image',validateUpdate(){}};

export const demoStarterKit:NodeExtension<HybridNode>[]=[paragraphExtension,headingExtension,checklistExtension,imageExtension,editableTableExtension,tableCellExtension,quoteExtension,...listCommands.extensions].map(extension=>({...extension,codec:demoCodecs[extension.name]}));
export const demoSchema=createSchema(demoStarterKit);

export const demoDocumentCodec=createDocumentCodec(demoSchema);
