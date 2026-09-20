import {useLayoutEffect,useRef,useState} from 'react';
import type {ImageNode} from './extensions/demo-model';
import {streamConfig} from './hybrid-stream';

const decoded = new Map<string,{width:number;height:number}>();
export function ImageBlock({node,width,onMeasure}:{node:ImageNode;width:number;onMeasure:(id:number,width:number,height:number)=>void}) {
  const [size,setSize]=useState(()=>decoded.get(node.src));
  const [failed,setFailed]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(size)return;
    let active=true;
    const timer=setTimeout(()=>{
      const image=new Image();image.src=node.src;
      image.decode().then(()=>{
        const next={width:image.naturalWidth,height:image.naturalHeight};decoded.set(node.src,next);
        if(active)setSize(next);
      }).catch(()=>{if(active)setFailed(true);});
    },streamConfig.imageDelay);
    return()=>{active=false;clearTimeout(timer);};
  },[node.src,size]);
  useLayoutEffect(()=>{
    const element=ref.current;if(!element)return;
    const report=()=>onMeasure(node.id,width,element.offsetHeight);
    const observer=new ResizeObserver(report);observer.observe(element);report();
    return()=>observer.disconnect();
  },[node.id,width,onMeasure]);
  return <div ref={ref} data-image={node.id} className="image-block" style={{height:size?width*size.height/size.width:96}}>
    {size?<img src={node.src} alt={node.alt} width={size.width} height={size.height}/>:<span>{failed?'Image unavailable':'Loading illustration…'}</span>}
  </div>;
}
