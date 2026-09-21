import {formattingSchema} from './formatting';
import {demoCodecs} from './demo-codecs';
import {normalizeMarks,sliceMarks,createDocumentCodec,createSchema,validateInlineObjects,sliceInlineObjects,type NodeExtension} from '../editor';
import {replaceText,type StarterNode,type TextBlockNode} from './demo-model';
import {editableTableExtension,tableCellExtension} from './table';
import {listCommands,quoteExtension} from './blocks';
function textBlock(node:StarterNode):TextBlockNode{
  if((node.kind!=='paragraph'&&node.kind!=='heading'))throw new Error('Text extension requires a paragraph or heading');return node;
}
function slice(node:TextBlockNode,from:number,to:number,id=node.id):TextBlockNode{
  return {...node,id,text:node.text.slice(from,to),
    marks:sliceMarks(node.marks,from,to),
    inline:sliceInlineObjects(node.inline,from,to)};
}
function joined(left:TextBlockNode,right:TextBlockNode):TextBlockNode{
  const offset=left.text.length;
  return {...left,text:left.text+right.text,marks:normalizeMarks([...left.marks,...right.marks.map(range=>({...range,from:range.from+offset,to:range.to+offset}))]),inline:[...left.inline,...right.inline.map(a=>({...a,index:a.index+offset}))]};
}

export const paragraphExtension:NodeExtension<StarterNode>={
  name:'paragraph',version:2,kind:'text',accepts:node=>node.kind==='paragraph',
  validateUpdate(before,after){
    const a=textBlock(before),b=textBlock(after);
    if(a.text!==b.text||a.inline!==b.inline)throw new Error('Text and inline objects require explicit editing operations');
    formattingSchema.validate(b.text,b.marks);
  },
  editing:{
    text:node=>textBlock(node).text,
    marks:{validate:marks=>marks.map(mark=>formattingSchema.create(mark.type,mark.attrs)),boundary:formattingSchema.boundary,read:node=>textBlock(node).marks,write(node,marks){const text=textBlock(node);return {...text,marks:formattingSchema.validate(text.text,marks)};}},
    replace(node,from,to,text){const next=replaceText(textBlock(node),from,to,text);validateInlineObjects(next.text,next.inline);return next;},
    split(node,at,right){const p=textBlock(node);const tail={...slice(p,at,p.text.length,right.id),key:right.key};return [slice(p,0,at),at===p.text.length?{kind:'paragraph',id:tail.id,key:tail.key,locked:tail.locked,text:tail.text,marks:tail.marks,inline:tail.inline}:tail];},
    join:(left,right)=>joined(textBlock(left),textBlock(right)),
  },
};
export const headingExtension:NodeExtension<StarterNode>={...paragraphExtension,name:'heading',accepts:node=>node.kind==='heading'};
export const checklistExtension:NodeExtension<StarterNode>={name:'checklist',version:1,kind:'atom',accepts:node=>node.kind==='checklist',validateUpdate(){}};
export const imageExtension:NodeExtension<StarterNode>={name:'image',version:1,kind:'atom',accepts:node=>node.kind==='image',validateUpdate(){}};

export const demoStarterKit:NodeExtension<StarterNode>[]=[paragraphExtension,headingExtension,checklistExtension,imageExtension,editableTableExtension,tableCellExtension,quoteExtension,...listCommands.extensions].map(extension=>({...extension,codec:demoCodecs[extension.name]}));
export const demoSchema=createSchema(demoStarterKit);

export const demoDocumentCodec=createDocumentCodec(demoSchema);
