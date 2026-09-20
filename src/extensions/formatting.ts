import type {HybridSpan,TextBlockNode} from './demo-model';

export type TextFormat='bold'|'italic'|'underline';

export function hasFormat(node:TextBlockNode,from:number,to:number,key:TextFormat):boolean{
  let covered=from;
  for(const span of node.spans.filter(s=>s[key]).sort((a,b)=>a.start-b.start)){
    if(span.start>covered)break;
    covered=Math.max(covered,span.end);
    if(covered>=to)return true;
  }
  return false;
}

/** Change a mark without changing text, inline objects, or annotation positions. */
export function setFormat(node:TextBlockNode,from:number,to:number,key:TextFormat,enabled:boolean):TextBlockNode{
  const points=[...new Set([0,node.text.length,from,to,...node.spans.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);
  const spans:HybridSpan[]=[];
  for(let i=0;i<points.length-1;i++){
    const start=points[i],end=points[i+1];
    const current=node.spans.filter(s=>s.start<=start&&s.end>=end);
    const style={bold:current.some(s=>s.bold),italic:current.some(s=>s.italic),underline:current.some(s=>s.underline)};
    if(start>=from&&end<=to)style[key]=enabled;
    if(!style.bold&&!style.italic&&!style.underline)continue;
    const previous=spans.at(-1);
    if(previous&&previous.end===start&&previous.bold===style.bold&&previous.italic===style.italic&&previous.underline===style.underline)previous.end=end;
    else spans.push({start,end,...style});
  }
  return {...node,spans};
}

export function clearFormatting(node:TextBlockNode,from:number,to:number):TextBlockNode{
  return {...node,spans:node.spans.flatMap(span=>{
    if(span.end<=from||span.start>=to)return [span];
    return [...(span.start<from?[{...span,end:from}]:[]),...(span.end>to?[{...span,start:to}]:[])];
  })};
}
