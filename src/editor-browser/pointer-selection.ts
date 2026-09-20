import {TextSelection,type TextHit} from '../editor';

type MouseInput=Pick<MouseEvent,'defaultPrevented'|'button'|'target'|'currentTarget'|'clientX'|'clientY'|'shiftKey'|'detail'|'preventDefault'>;
type PointerInput=MouseInput&Pick<PointerEvent,'pointerId'|'pointerType'>;
export type PointerSelectionOptions={
 hitTest:(clientX:number,clientY:number)=>TextHit|null;
 selection:()=>TextSelection;
 onSelect:(selection:TextSelection)=>void;
 focus:()=>void;
 selectRange?:(hit:TextHit,clicks:number)=>TextSelection|null;
 onStart?:(hit:TextHit,clicks:number)=>void;
 onDrag?:(hit:TextHit)=>void;
};
/** Spread these handlers on the entire editor surface, including its gutters.
 * Native controls and data-editor-interactive opt out. Non-atomic decorations
 * may opt back into text selection with data-editor-text-hit.
 */
export function createPointerSelection(options:PointerSelectionOptions){
 let mouse=0,drag:{pointerId:number;anchor:TextSelection['anchor'];x:number;y:number}|null=null;
 function begin(event:MouseInput,pointerId:number,clicks:number){
  if(event.defaultPrevented||event.button!==0||!(event.target instanceof Element))return;
  if(!event.target.closest('[data-editor-text-hit]')&&event.target.closest('button,a,input,textarea,select,summary,label,[role="button"],[role="dialog"],[contenteditable="true"],[data-editor-interactive]'))return;
  const hit=options.hitTest(event.clientX,event.clientY);if(!hit)return;
  event.preventDefault();
  const next=options.selectRange?.(hit,clicks)??new TextSelection(event.shiftKey?options.selection().anchor:hit.point,hit.point,hit.upstream);
  drag={pointerId,anchor:next.anchor,x:event.clientX,y:event.clientY};
  if(pointerId&&event.currentTarget instanceof HTMLElement)event.currentTarget.setPointerCapture(pointerId);
  options.onSelect(next);options.onStart?.(hit,clicks);options.focus();
 }
 return {
  onPointerDown(event:PointerInput){if(event.pointerType==='mouse'){mouse=event.pointerId;return;}begin(event,event.pointerId,1);},
  onMouseDown(event:MouseInput){begin(event,mouse,event.detail);},
  onPointerMove(event:PointerInput){
   const current=drag;if(!current||current.pointerId!==event.pointerId||Math.hypot(event.clientX-current.x,event.clientY-current.y)<3)return;
   const hit=options.hitTest(event.clientX,event.clientY);if(!hit)return;
   options.onSelect(new TextSelection(current.anchor,hit.point,hit.upstream));options.onDrag?.(hit);
  },
  onPointerUp(event:PointerInput){if(drag?.pointerId!==event.pointerId)return;drag=null;if(event.currentTarget instanceof HTMLElement&&event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);},
  onPointerCancel(){drag=null;},onLostPointerCapture(){drag=null;},
 };
}
