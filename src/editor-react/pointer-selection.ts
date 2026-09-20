import {useRef,type MouseEvent,type PointerEvent} from 'react';
import {TextSelection,type TextHit} from '../editor';

type Options={
 hitTest:(clientX:number,clientY:number)=>TextHit|null;
 selection:TextSelection;
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
export function usePointerSelection(options:Options){
 const mouse=useRef(0),drag=useRef<{pointerId:number;anchor:TextSelection['anchor'];x:number;y:number}|null>(null);
 function begin(event:MouseEvent<HTMLElement>|PointerEvent<HTMLElement>,pointerId:number,clicks:number){
  if(event.defaultPrevented||event.button!==0||!(event.target instanceof Element))return;
  if(!event.target.closest('[data-editor-text-hit]')&&event.target.closest('button,a,input,textarea,select,summary,label,[role="button"],[role="dialog"],[contenteditable="true"],[data-editor-interactive]'))return;
  const hit=options.hitTest(event.clientX,event.clientY);if(!hit)return;
  event.preventDefault();
  const next=options.selectRange?.(hit,clicks)??new TextSelection(event.shiftKey?options.selection.anchor:hit.point,hit.point,hit.upstream);
  drag.current={pointerId,anchor:next.anchor,x:event.clientX,y:event.clientY};
  event.currentTarget.setPointerCapture(pointerId);
  options.onSelect(next);options.onStart?.(hit,clicks);options.focus();
 }
 return {
  onPointerDown(event:PointerEvent<HTMLElement>){if(event.pointerType==='mouse'){mouse.current=event.pointerId;return;}begin(event,event.pointerId,1);},
  onMouseDown(event:MouseEvent<HTMLElement>){begin(event,mouse.current,event.detail);},
  onPointerMove(event:PointerEvent<HTMLElement>){
   const current=drag.current;if(!current||current.pointerId!==event.pointerId||Math.hypot(event.clientX-current.x,event.clientY-current.y)<3)return;
   const hit=options.hitTest(event.clientX,event.clientY);if(!hit)return;
   options.onSelect(new TextSelection(current.anchor,hit.point,hit.upstream));options.onDrag?.(hit);
  },
  onPointerUp(event:PointerEvent<HTMLElement>){if(drag.current?.pointerId!==event.pointerId)return;drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);},
  onPointerCancel(){drag.current=null;},onLostPointerCapture(){drag.current=null;},
 };
}
