import {createContext,useContext,useLayoutEffect} from 'react';
import type {Canvas,CanvasKit,Paint} from 'canvaskit-wasm';
export type CanvasPainter = (canvas:Canvas,kit:CanvasKit,paint:Paint)=>void;
export type CanvasPaintLayer='background'|'content';
export type RegisterCanvasPainter = (id:string,painter:CanvasPainter,layer:CanvasPaintLayer)=>()=>void;
const PaintContext=createContext<RegisterCanvasPainter|null>(null);
export const CanvasLayerProvider=PaintContext.Provider;
/** Canvas extensions share the host's viewport pass and release registration on unmount. */
export function CanvasPrimitive({id,paint,layer='content'}:{id:string;paint:CanvasPainter;layer?:CanvasPaintLayer}){
  const register=useContext(PaintContext);
  if(!register)throw new Error('CanvasPrimitive requires a CanvasLayerProvider');
  useLayoutEffect(()=>register(id,paint,layer),[register,id,paint,layer]);return null;
}

export {usePointerSelection} from './pointer-selection';
