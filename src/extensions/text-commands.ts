import {selectionContext,type EditorState,type Schema,type Step} from '../editor';
import {indexTree} from '../editor';
import type {HybridNode} from './demo-model';
import {clearFormatting,hasFormat,setFormat,type TextFormat} from './formatting';

/** Extension commands return ordinary transactions; the core owns history/mapping. */
export function textCommands(schema:Schema<HybridNode>,state:EditorState<HybridNode>,tree=indexTree(schema,state.nodes)){
  const ranges=state.selection.ranges(selectionContext(schema,state.nodes,tree)).flatMap(range=>{
    const node=tree.byId.get(range.id)?.node;
    return range.kind==='text'&&range.from<range.to&&(node?.kind==='paragraph'||node?.kind==='heading')?[{node,from:range.from,to:range.to}]:[];
  });
  const active=(key:TextFormat)=>ranges.length>0&&ranges.every(({node,from,to})=>hasFormat(node,from,to,key));
  return {
    available:ranges.length>0,
    active,
    toggle(key:TextFormat):Step<HybridNode>[]{
      const enabled=!active(key);
      return ranges.map(({node,from,to})=>({kind:'updateBlock',node:setFormat(node,from,to,key,enabled)}));
    },
    clear():Step<HybridNode>[]{return ranges.map(({node,from,to})=>({kind:'updateBlock',node:clearFormatting(node,from,to)}));},
    comment(id:string):{steps:Step<HybridNode>[];target:{nodeId:number;commentId:string}|null}{
      return {
        steps:ranges.map(({node,from,to})=>({kind:'updateBlock',node:{...node,comments:[...node.comments,{id,start:from,end:to,data:{reply:''}}]}})),
        target:ranges[0]?{nodeId:ranges[0].node.id,commentId:id}:null,
      };
    },
  };
}
