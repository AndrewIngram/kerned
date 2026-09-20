import {useMemo} from 'react';
import type {CanvasKit} from 'canvaskit-wasm';
import {CanvasPrimitive,type CanvasPainter as Painter} from '../editor-react';
import type {createOwnedEngine} from '../owned-layout';
import type {LaidOut} from '../engines';
import type {HybridNode} from './demo-model';
type Owned=Awaited<ReturnType<typeof createOwnedEngine>>;
type InlineBox=Pick<ReturnType<Owned['layoutInline']>['inlineBoxes'][number],'id'|'index'|'label'|'x'|'y'|'width'|'height'>;
type TextPlacement={node:HybridNode;y:number;layout:LaidOut|null;boxes:InlineBox[]};
export function ParagraphExtensions({placement:p,kit,owned,open}:{placement:TextPlacement;kit:CanvasKit;owned:Owned;open:(kind:'mention'|'comment',atomId:string|undefined,index:number)=>void}){
  const node=p.node;
  const decorations=useMemo(()=>(node.kind==='paragraph'||node.kind==='heading')&&p.layout?node.comments.flatMap(c=>p.layout?.geometry(c.start,c.end,false).rects.map(rect=>({comment:c,rect}))??[]):[],[p.layout,node]);
  const underlines=useMemo(()=>(node.kind==='paragraph'||node.kind==='heading')&&p.layout?node.spans.filter(s=>s.underline).flatMap(s=>p.layout?.geometry(s.start,s.end,false).rects.map(rect=>({rect,baseline:p.layout?.lines.find(line=>line.top<=rect[1]&&line.bottom>rect[1])?.baseline??rect[3]-6}))??[]):[],[p.layout,node]);
  const paint=useMemo<Painter>(()=>(canvas,k,brush)=>{
    brush.setColor(k.Color(246,234,180));for(const {rect:r} of decorations)canvas.drawRect(k.XYWHRect(r[0],p.y+r[1],r[2]-r[0],r[3]-r[1]),brush);
  },[decorations,p.y]);
  const paintUnderline=useMemo<Painter>(()=>(canvas,k,brush)=>{brush.setColor(k.Color(41,50,39));for(const {rect:r,baseline} of underlines)canvas.drawRect(k.XYWHRect(r[0],p.y+baseline+2,r[2]-r[0],1),brush);},[underlines,p.y]);
  return <><CanvasPrimitive id={`decoration-${node.id}`} paint={paint} layer="background"/><CanvasPrimitive id={`underline-${node.id}`} paint={paintUnderline}/>{p.boxes.map(box=><Mention key={box.id} box={box} y={p.y} kit={kit} owned={owned} onOpen={()=>open('mention',box.id,box.index)}/>)}{(node.kind==='paragraph'||node.kind==='heading')&&decorations.map(({rect:r,comment},i)=><button key={i} className="range-hit" data-editor-text-hit data-decoration={node.id} aria-label="Open comment on highlighted text" style={{left:28+r[0],top:p.y+r[1],width:r[2]-r[0],height:r[3]-r[1]}} onClick={event=>{if(event.detail===0)open('comment',comment.id,comment.start);}}/>)}</>;
}
function Mention({box,y,owned,onOpen}:{box:InlineBox;y:number;kit:CanvasKit;owned:Owned;onOpen:()=>void}){
  const label=useMemo(()=>owned.engine.layout({id:900000,text:box.label,spans:[],width:box.width-12,size:18}),[owned,box.label,box.width]);
  const background=useMemo<Painter>(()=>(canvas,kit,paint)=>{paint.setColor(kit.Color(229,237,218));canvas.drawRRect(kit.RRectXY(kit.XYWHRect(box.x,y+box.y,box.width,box.height),4,4),paint);},[box.x,box.y,box.width,box.height,y,label]);
  const labelPainter=useMemo<Painter>(()=>canvas=>label.draw(canvas,box.x+6,y+box.y+(box.height-label.height)/2),[label,box.x,box.y,box.height,y]);
  return <><CanvasPrimitive id={`mention-background-${box.id}`} paint={background} layer="background"/><CanvasPrimitive id={`mention-${box.id}`} paint={labelPainter}/><button className="mention-hit" data-mention={box.id} aria-label={`Open ${box.label}`} style={{left:28+box.x,top:y+box.y,width:box.width,height:box.height}} onClick={onOpen}/></>;
}
