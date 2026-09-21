import {useRef} from 'react';
import {createPointerSelection,type PointerSelectionOptions} from '../editor-browser/pointer-selection';
import type {TextSelection} from '../editor';

export function usePointerSelection(options:Omit<PointerSelectionOptions,'selection'>&{selection:TextSelection}){
 const latest=useRef(options);latest.current=options;
 const controller=useRef<ReturnType<typeof createPointerSelection>|null>(null);

 if(!controller.current)controller.current=createPointerSelection({selection:()=>latest.current.selection,hitTest:(x,y)=>latest.current.hitTest(x,y),onSelect:value=>latest.current.onSelect(value),focus:()=>latest.current.focus(),selectRange:(hit,clicks)=>latest.current.selectRange?.(hit,clicks)??null,onStart:(hit,clicks)=>latest.current.onStart?.(hit,clicks),onDrag:hit=>latest.current.onDrag?.(hit)});

 return controller.current;
}
