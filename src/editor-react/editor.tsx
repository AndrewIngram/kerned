import {useLayoutEffect,useRef,type ComponentPropsWithoutRef} from 'react';
import {mountEditorView,type BrowserViewOptions} from '../editor-browser';

/** Optional React host. The caller owns the session and supplies its renderer as children. */
export function Editor({view,children,...props}:ComponentPropsWithoutRef<'div'>&{view:BrowserViewOptions}){
  const element=useRef<HTMLDivElement>(null),runtime=useRef<ReturnType<typeof mountEditorView>|null>(null);
  useLayoutEffect(()=>{
    if(!element.current)return;
    const mounted=mountEditorView(element.current,view);runtime.current=mounted;

    return()=>{mounted.destroy();runtime.current=null;};
  },[]);
  useLayoutEffect(()=>{runtime.current?.update(view);});

  return <div {...props} ref={element}>{children}</div>;
}
