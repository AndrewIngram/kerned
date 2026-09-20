import {normalizeMarks,createMarkSchema,type MarkRange} from '../editor';
import type {HybridSpan} from './demo-model';

export type TextFormat='bold'|'italic'|'underline';
const formats:readonly TextFormat[]=['bold','italic','underline'];
export const formattingSchema=createMarkSchema(formats.map(name=>({name,version:1,parse(attrs:unknown){if(attrs!==null)throw new Error(`${name} takes no attributes`);return null;}})));
export function formattingMarks(spans:readonly HybridSpan[]):MarkRange[]{
  return normalizeMarks(spans.flatMap(span=>formats.filter(type=>span[type]).map(type=>({from:span.start,to:span.end,mark:formattingSchema.create(type,null)}))));
}
/** Project semantic marks to the compact font-style runs consumed by layout. */
export function formattingSpans(ranges:readonly MarkRange[]):HybridSpan[]{
  const points=[...new Set(ranges.flatMap(range=>[range.from,range.to]))].sort((a,b)=>a-b),spans:HybridSpan[]=[];
  for(let i=0;i<points.length-1;i++){
    const start=points[i],end=points[i+1],active=ranges.filter(range=>range.from<=start&&range.to>=end);
    const style={bold:active.some(range=>range.mark.type==='bold'),italic:active.some(range=>range.mark.type==='italic'),underline:active.some(range=>range.mark.type==='underline')};
    if(!style.bold&&!style.italic&&!style.underline)continue;
    const previous=spans.at(-1);
    if(previous&&previous.end===start&&previous.bold===style.bold&&previous.italic===style.italic&&!!previous.underline===style.underline)previous.end=end;
    else spans.push({start,end,...style});
  }
  return spans;
}
