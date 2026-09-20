import {inlineSchema} from './mention';
import {jsonRecord,jsonString,jsonNumber,jsonBoolean,jsonArray,type NodeCodec,type JsonValue} from '../editor';
import type {HybridNode,TextBlockNode,TableCell} from './demo-model';
import {formattingSchema} from './formatting';

function integer(value:unknown,min=0){const result=jsonNumber(value);if(!Number.isSafeInteger(result)||result<min)throw new Error('Expected an integer in range');return result;}
function textNode(node:HybridNode):TextBlockNode{if(node.kind!=='paragraph'&&node.kind!=='heading')throw new Error('Expected text node');return node;}
function textData(node:HybridNode):{[key:string]:JsonValue}{
  const text=textNode(node);
  return {text:text.text,marks:formattingSchema.encode(text.marks),inline:inlineSchema.encode(text.inline)};
}
function parseText(value:unknown){
  const data=jsonRecord(value),text=jsonString(data.text);
  const marks=formattingSchema.decode(text,data.marks);
  const inline=inlineSchema.decode(text,data.inline);
  return {text,marks:formattingSchema.validate(text,marks),inline};
}
function paragraphs(children:HybridNode[]):TextBlockNode[]{return children.map(textNode);}
function cell(node:HybridNode):TableCell{if(node.kind!=='tableCell')throw new Error('Expected table cell');return node;}
function textCodec(kind:'paragraph'|'heading'):NodeCodec<HybridNode>{return {
  encode(node):JsonValue{const data=textData(node);if(kind==='heading'&&node.kind==='heading')return {...data,level:node.level};return data;},
  decode(data,{identity}){
    const text=parseText(data);
    if(kind==='paragraph')return {kind,...identity,...text};
    const level=integer(jsonRecord(data).level,1);if(level!==1&&level!==2&&level!==3&&level!==4)throw new Error('Invalid heading level');
    return {kind,level,...identity,...text};
  },
};}
function atom(kind:'checklist'|'image'):NodeCodec<HybridNode>{return {
  encode(node):JsonValue{
    if(node.kind==='checklist')return {checked:node.checked,expanded:node.expanded,notes:node.notes};
    if(node.kind==='image')return {src:node.src,alt:node.alt};
    throw new Error('Expected atom');
  },
  decode(value,{identity}){const data=jsonRecord(value);return kind==='checklist'?{kind,...identity,checked:jsonArray(data.checked).map(jsonBoolean),expanded:jsonBoolean(data.expanded),notes:jsonString(data.notes)}:{kind,...identity,src:jsonString(data.src),alt:jsonString(data.alt)};},
};}
function container(kind:'quote'|'listItem'|'list'):NodeCodec<HybridNode>{return {
  encode(node):JsonValue{return node.kind==='list'?{ordered:node.ordered,start:node.start}:{};},
  decode(value,{identity,children}){const data=jsonRecord(value);return kind==='list'?{kind,...identity,children,ordered:jsonBoolean(data.ordered),start:integer(data.start,1)}:{kind,...identity,children};},
};}
export const demoCodecs:Readonly<Record<string,NodeCodec<HybridNode>>>={
  paragraph:textCodec('paragraph'),heading:textCodec('heading'),checklist:atom('checklist'),image:atom('image'),quote:container('quote'),listItem:container('listItem'),list:container('list'),
  tableCell:{
    encode(node):JsonValue{const value=cell(node);return {row:value.row,header:value.header,colspan:value.colspan,rowspan:value.rowspan};},
    decode(value,{identity,children}){const data=jsonRecord(value);return {kind:'tableCell',...identity,row:integer(data.row),header:jsonBoolean(data.header),colspan:integer(data.colspan,1),rowspan:integer(data.rowspan,1),paragraphs:paragraphs(children)};},
  },
  table:{
    encode(node):JsonValue{if(node.kind!=='table')throw new Error('Expected table');return {caption:node.caption,rowLengths:node.rows.map(row=>row.length)};},
    decode(value,{identity,children}){
      const data=jsonRecord(value),lengths=jsonArray(data.rowLengths).map(value=>integer(value,1)),cells=children.map(cell);
      if(lengths.reduce((a,b)=>a+b,0)!==cells.length)throw new Error('Table row sizes do not match children');
      let offset=0;const rows=lengths.map((length,index)=>{const row=cells.slice(offset,offset+length);offset+=length;if(row.some(cell=>cell.row!==index))throw new Error('Cell row index does not match table structure');return row;});
      return {kind:'table',...identity,caption:jsonString(data.caption),rows};
    },
  },
};
