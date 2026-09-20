import {typography} from './extensions/typography';
import {mention} from './extensions/mention';
import type {CanvasKit} from 'canvaskit-wasm';
import {createOwnedEngine} from './owned-layout';
import type {HybridLeaf} from './extensions/demo-model';
import type {Measurement,Scene} from './hybrid-scene';

/** Independent eager reference: compose each paragraph from scratch at the target width. */
export async function checkReflow(kit:CanvasKit,nodes:HybridLeaf[],scene:Scene,measurements:ReadonlyMap<number,Measurement>){
  const owned=await createOwnedEngine(kit,'shaping');
  let y=32+scene.paddingTop,paragraphs=0,hydrated=0;
  try{
    for(let i=0;i<nodes.length;i++){
      const node=nodes[i],actual=scene.placements[i];
      if(i){const previous=nodes[i-1];const after=previous.kind==='paragraph'||previous.kind==='heading'?typography(previous,20).after:24;const before=node.kind==='paragraph'||node.kind==='heading'?typography(node,20).before:0;y+=Math.max(after,before);}
      if(!actual||actual.node!==node||actual.y!==y)throw new Error(`Placement differs at ${node.id}`);
      if((node.kind==='paragraph'||node.kind==='heading')){
        const style=typography(node,20);
        const spans=node.kind==='heading'&&node.text.length?[...node.spans,{start:0,end:node.text.length,bold:true,italic:false}]:node.spans;
        const input={id:-1,text:node.text,spans,width:scene.width,size:style.size,lineHeight:style.lineHeight,baselineGrid:4};
        const expected=node.atoms.length?owned.layoutInline({...input,atoms:node.atoms.map(mention.layout)}):owned.engine.layout(input);
        const geometry=(layout:typeof expected)=>[layout.height,layout.lines,layout.geometry(0,node.text.length,false),layout.move(0,false,'end'),layout.hit(10,10)];
        if(actual.height!==expected.height||actual.layoutWidth!==scene.width||actual.layout&&JSON.stringify(geometry(actual.layout))!==JSON.stringify(geometry(expected)))throw new Error(`Geometry differs at ${node.id}`);
        if(actual.layout)hydrated++;
        if(actual.layout&&'inlineBoxes' in expected&&JSON.stringify(actual.boxes)!==JSON.stringify(expected.inlineBoxes))throw new Error(`Inline rectangles differ at ${node.id}`);
        y+=expected.height;paragraphs++;
      }else{
        const measured=measurements.get(node.id);
        const height=measured?.width===scene.width?measured.height:node.kind==='image'?96:node.kind==='table'?Math.max(60,node.rows.length*64):node.expanded?290:190;
        if(height!==actual.height)throw new Error(`Widget height differs at ${node.id}`);
        y+=Math.ceil(height/4)*4;
      }
    }
    if(y+24!==scene.height||scene.pending)throw new Error('Document reflow is incomplete');
    return {blocks:nodes.length,paragraphs,hydrated,checks:'passed'};
  }finally{owned.engine.clear();}
}
