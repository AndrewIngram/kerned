import {createInlineSchema,jsonRecord,jsonString,jsonNumber,type InlineValueExtension} from '../editor';
import type {InlineAtom} from '../owned-inline';
export type MentionData=Pick<InlineAtom,'label'|'width'|'ascent'|'descent'>;
function attributes(value:unknown):MentionData{
  const data=jsonRecord(value),label=jsonString(data.label),width=jsonNumber(data.width),ascent=jsonNumber(data.ascent),descent=jsonNumber(data.descent);
  if(width<0||ascent<0||descent<0)throw new Error('Invalid mention dimensions');return {label,width,ascent,descent};
}
export const mention:InlineValueExtension<InlineAtom>={
  name:'mention',version:1,parse:attributes,plainText:value=>attributes(value).label,
  layout:value=>({id:value.id,index:value.index,...attributes(value.attrs)}),
};
export const inlineSchema=createInlineSchema([mention]);
export function createMention({id,index,...attrs}:InlineAtom){return inlineSchema.create('mention',id,index,attrs);}
