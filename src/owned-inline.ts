import {supportsOwnedText} from './owned-text-support';
import { boundaries, type Span } from './model';
import type { Glyph, Cluster, Shaped } from './owned-paragraph';

export type InlineAtom = { id: string; index: number; width: number; ascent: number; descent: number; label: string };

export function shapeInlineParagraph(text: string, spans: Span[], atoms: readonly InlineAtom[], shape: (text: string, font: number) => {glyphs: Glyph[]; breaks: number[]}): Shaped {
  const stops = new Set(boundaries(text));
  const sorted = [...atoms].sort((a,b)=>a.index-b.index);
  const ids = new Set<string>(), indices = new Set<number>();

  for(const atom of sorted) {
    if(ids.has(atom.id)||indices.has(atom.index)||!stops.has(atom.index)||text[atom.index]!=='\ufffc'||!stops.has(atom.index+1))throw new Error('Invalid inline atom position or identity');

    if(!(atom.width>0&&atom.ascent>=0&&atom.descent>=0&&atom.ascent+atom.descent>0&&[atom.width,atom.ascent,atom.descent].every(Number.isFinite)))throw new Error('Invalid inline atom metrics');
    ids.add(atom.id);indices.add(atom.index);
  }

  for(let i=0;i<text.length;i++)if(text[i]==='\ufffc'&&!indices.has(i))throw new Error('Missing inline atom');

  if(text.includes('\n')||!supportsOwnedText(text))throw new Error('Inline prototype supports Latin paragraphs and emoji');

  for(const span of spans)if(!(span.start<span.end&&stops.has(span.start)&&stops.has(span.end)))throw new Error('Invalid inline formatting');
  const clusters:Cluster[]=[], breaks=new Set<number>();

  function segment(start:number,end:number) {
    if(start===end)return;
    const value=text.slice(start,end), base=shape(value,0);

    for(const b of base.breaks)breaks.add(b+start);
    const local=spans.filter(s=>s.end>start&&s.start<end).map(s=>({...s,start:Math.max(start,s.start)-start,end:Math.min(end,s.end)-start}));
    let glyphs=base.glyphs;

    if(local.length){
      const cuts=[...new Set([0,value.length,...local.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);
      glyphs=cuts.slice(0,-1).flatMap((from,i)=>{
        const active=local.filter(s=>s.start<=from&&s.end>from),font=Number(active.some(s=>s.bold))+2*Number(active.some(s=>s.italic));

        return shape(value.slice(from,cuts[i+1]),font).glyphs.map(g=>({...g,start:g.start+from}));
      });
    }

    const first=clusters.length;

    for(const glyph of glyphs){
      const shifted={...glyph,start:glyph.start+start};let cluster=clusters.at(-1);

      if(clusters.length===first||!cluster||cluster.start!==shifted.start){
        if(clusters.length>first)clusters[clusters.length-1].end=shifted.start;
        cluster={start:shifted.start,end,width:0,glyphs:[],stops:[]};clusters.push(cluster);
      }

      cluster.glyphs.push(shifted);cluster.width+=shifted.advance;
    }

    const points=boundaries(value);let cursor=1;

    for(let c=first;c<clusters.length;c++)while(cursor<points.length&&points[cursor]+start<=clusters[c].end){clusters[c].stops.push(points[cursor++]+start);}
  }

  let start=0;

  for(const atom of sorted){segment(start,atom.index);breaks.add(atom.index);clusters.push({start:atom.index,end:atom.index+1,width:atom.width,glyphs:[],stops:[atom.index+1]});breaks.add(atom.index+1);start=atom.index+1;}

  segment(start,text.length);

  return {clusters,breaks};
}
