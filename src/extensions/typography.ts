import type {HeadingLevel,TextBlockNode} from './demo-model';

const headings:Record<HeadingLevel,{size:number;lineHeight:number;before:number;after:number}>={
  1:{size:36,lineHeight:44,before:40,after:24},
  2:{size:28,lineHeight:36,before:32,after:12},
  3:{size:24,lineHeight:32,before:24,after:12},
  4:{size:20,lineHeight:28,before:24,after:8},
};

export function typography(node:TextBlockNode,bodySize:number){
  const scale=bodySize/18;
  const style=node.kind==='heading'?headings[node.level]:{size:18,lineHeight:28,before:0,after:16};

  return {size:style.size*scale,lineHeight:Math.round(style.lineHeight*scale/4)*4,before:Math.round(style.before*scale/4)*4,after:Math.round(style.after*scale/4)*4};
}
