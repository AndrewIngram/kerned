const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const words=new Intl.Segmenter(undefined,{granularity:'word'});
/** Returns the word, punctuation, or whitespace segment at a text position. */
export function wordRange(text:string,offset:number):{from:number;to:number}{
  const segment=words.segment(text).containing(Math.max(0,Math.min(offset,text.length-1)));
  return segment?{from:segment.index,to:segment.index+segment.segment.length}:{from:0,to:0};
}
export function boundaries(text:string):number[]{return [...graphemes.segment(text)].map(s=>s.index).concat(text.length);}
export function validateTextRange(text:string,from:number,to:number){
  const stops=new Set(boundaries(text));
  if(from>to||!stops.has(from)||!stops.has(to))throw new Error('Edit range must follow grapheme boundaries');
}
