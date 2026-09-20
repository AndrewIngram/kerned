import {createTextNavigation} from './editor';
import {hitTestTextLines,type TextHitRegion} from './editor';
import {usePointerSelection} from './editor-react';
import {supportsOwnedText} from './owned-text-support';
import {writeClipboard,readClipboard,pasteFragment} from './extensions/clipboard';
import {pasteParagraphs} from './extensions/paste';
import {createOutlineExtension,type OutlineEntry} from './extensions/outline';
import {OutlineMenu} from './extensions/outline-view';
import {selectedBlockLabel,setTextBlockType} from './extensions/headings';
import {checkSelections} from './editor-selection-checks';
import {checkContainers,benchmarkContainerEdits} from './editor-container-checks';
import {checkExtensions} from './editor-extension-checks';
import {CanvasLayerProvider,type CanvasPainter as Painter,type CanvasPaintLayer} from './editor-react';
import {ParagraphExtensions} from './extensions/text-block-view';
import {demoSchema} from './extensions/demo-schema';
import {createContext,startTransition,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal,flushSync} from 'react-dom';
import CanvasKitInit,{type CanvasKit,type Paint} from 'canvaskit-wasm';
import {createOwnedEngine} from './owned-layout';
import type {Rect} from './engines';
import {plainText,type HybridNode,type ChecklistNode} from './extensions/demo-model';
import {boundaries} from './model';
import './hybrid.css';
import {type TextFormat} from './extensions/formatting';
import {wordRange} from './editor/text';
import {textCommands} from './extensions/text-commands';
import {projectBlocks,blockCommands,listCommands,replaceStructuredText} from './extensions/blocks';
import {indexTree} from './editor/tree';
import {checkInline} from './owned-inline-checks';
import {createHybridScene,type Placement,type Scene} from './hybrid-scene';
import {streamConfig,createStreamMetrics} from './hybrid-stream';
import {bookSamples,loadHybridSample,sampleUrl,type HybridSample} from './hybrid-samples';
import {importHtml} from './extensions/html';
import {TableBlock} from './extensions/table-view';
import {tablePlainText,tableCells,createTable,appendTableRow,appendTableColumn} from './extensions/table';
import {ImageBlock} from './hybrid-image';
import {checkTransactions} from './hybrid-transaction-checks';
import {TextSelection,textSelection,createEditor,type Selection,type Step,type Transaction,selectionContext} from './editor';
import {createAnchor,parseAnchor,resolveAnchor} from './editor';
import {checkReflow} from './hybrid-reflow-checks';
import {FindBar,FindIcon} from './demo/find-bar';
import type {FindOptions,FindState,FindSnapshot} from './editor';

type Owned=Awaited<ReturnType<typeof createOwnedEngine>>;
const TeamContext=createContext('');
function Checklist({node,width,onChange,onMeasure}:{node:ChecklistNode;width:number;onChange:(node:ChecklistNode)=>void;onMeasure:(id:number,width:number,height:number)=>void}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const element=ref.current;if(!element)return;
    const observer=new ResizeObserver(()=>onMeasure(node.id,width,element.offsetHeight));observer.observe(element);
    onMeasure(node.id,width,element.offsetHeight);return()=>observer.disconnect();
  },[node.id,width,onMeasure]);
  return <div ref={ref} className="checklist" data-widget={node.id}>
    <div className="checklist-heading"><strong>Review checklist</strong><small>{node.checked.filter(Boolean).length} of 3 complete</small></div>
    {['Confirm the outline','Review the examples','Check the final wording'].map((label,i)=><label key={label}><input type="checkbox" checked={node.checked[i]} onChange={e=>onChange({...node,checked:node.checked.map((v,n)=>n===i?e.target.checked:v)})}/>{label}</label>)}
    <button aria-expanded={node.expanded} onClick={()=>onChange({...node,expanded:!node.expanded})}>{node.expanded?'Hide block notes':'Add block notes'}</button>
    {node.expanded&&<label className="notes-label">Block notes<textarea value={node.notes} onChange={e=>onChange({...node,notes:e.target.value})} placeholder="What needs attention?"/></label>}
  </div>;
}
function MentionDetails(){const team=useContext(TeamContext);return <><strong>Maya Chen</strong><p>Product designer · {team}</p></>;}
function App({kit,owned,sample,onSampleChange,loading}:{kit:CanvasKit;owned:Owned;sample:HybridSample;onSampleChange:(id:string)=>void;loading:boolean}){
  const minimal=location.pathname==='/editor.html';
  const [viewportHeight,setViewportHeight]=useState(520);
  const toolbarRef=useRef<HTMLElement>(null);
  const [toolbarHeight,setToolbarHeight]=useState(50);
  const renderStarted=performance.now();
  const [editor]=useState(()=>createEditor(demoSchema,sample.initial,textSelection(1,0),[tableCells.extension]));
  const [editorState,setEditorState]=useState(editor.state);
  const [findOpen,setFindOpen]=useState(false),[findRequest,setFindRequest]=useState(0),[findFocus,setFindFocus]=useState(0);
  const lastQuery=useRef(''),returnFocus=useRef<HTMLElement|null>(null),revealFind=useRef(false);
  const lastFindOptions=useRef<FindOptions>({matchCase:false}),findAbort=useRef<AbortController|null>(null);
  const findInFlight=useRef<readonly HybridNode[]|null>(null);
  const [findSnapshot,setFindSnapshot]=useState<FindSnapshot<HybridNode>>(()=>({state:editor.find.state,nodes:editor.state.nodes}));
  // Appended text cannot invalidate existing ranges. Keep the count and
  // highlights steady while the search catches up with the loading stream.
  const findStale=useMemo(()=>findSnapshot.nodes.length>editorState.nodes.length||findSnapshot.nodes.some((node,i)=>node!==editorState.nodes[i]),[findSnapshot.nodes,editorState.nodes]);
  const findState=useMemo<FindState>(()=>findStale?{...findSnapshot.state,matches:[],byNode:new Map(),activeIndex:-1,active:null}:findSnapshot.state,[findSnapshot,findStale]);
  const findMatches=findState.byNode;
  const findRef=useRef(findState);
  useLayoutEffect(()=>{findRef.current=findState;},[findState]);
  const requestFind=useCallback((query:string,options:FindOptions)=>{
    lastQuery.current=query;lastFindOptions.current=options;
    findAbort.current?.abort();const controller=new AbortController();findAbort.current=controller;
    findInFlight.current=editor.state.nodes;
    void editor.find.setQueryAsync(query,options,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      findInFlight.current=null;
      if(!result)return;
      startTransition(()=>setFindSnapshot(result));
    });
  },[editor]);
  useEffect(()=>{
    if(!findOpen)return;
    const inFlight=findInFlight.current;
    if(inFlight&&inFlight.length<=editorState.nodes.length&&inFlight.every((node,i)=>node===editorState.nodes[i]))return;
    requestFind(lastQuery.current,lastFindOptions.current);
  },[editorState.nodes,findOpen,requestFind]);
  useEffect(()=>()=>findAbort.current?.abort(),[]);
  const sourceLoaded=useRef(sample.initial.length),sourceRevision=useRef(0);
  const pendingOutline=useMemo(()=>sample.outline?.filter(item=>item.sourceIndex>=sourceLoaded.current).map(item=>item.entry)??[],[sample,editorState.nodes]);
  const [outlineExtension]=useState(()=>createOutlineExtension(demoSchema,node=>node.kind==='heading'?{level:node.level,title:plainText(node)}:null));
  const outline=useMemo(()=>outlineExtension.read(editorState.nodes,pendingOutline),[outlineExtension,editorState.nodes,pendingOutline]);
  const projection=useMemo(()=>projectBlocks(editorState.nodes),[editorState.nodes]);
  const {nodes}=projection;
  const tree=useMemo(()=>indexTree(demoSchema,editorState.nodes),[editorState.nodes]);
  const context=useMemo(()=>selectionContext(demoSchema,editorState.nodes,tree),[editorState.nodes,tree]);
  const primary=editorState.selection.ranges(context).find(r=>r.kind==='text');
  const selection=editorState.selection instanceof TextSelection?editorState.selection:textSelection(primary?.id??nodes[0].id,primary?.kind==='text'?primary.from:0);
  const nonTextSelection=!(editorState.selection instanceof TextSelection);
  function setSelection(next:Selection){setEditorState(editor.select(next));}
  const nodeIndexes=useMemo(()=>new Map(nodes.map((node,index)=>[node.id,index])),[nodes]);
  let findEntry=findOpen&&findState.active?tree.byId.get(findState.active.id):undefined;
  while(findEntry&&!nodeIndexes.has(findEntry.node.id))findEntry=findEntry.parent===null?undefined:tree.byId.get(findEntry.parent);
  const findBlockId=findEntry?.node.id;
  const anchorIndex=nodeIndexes.get(selection.anchor.id)??0,headIndex=nodeIndexes.get(selection.head.id)??0;
  const forward=anchorIndex<headIndex||anchorIndex===headIndex&&selection.anchor.offset<=selection.head.offset;
  const start=forward?selection.anchor:selection.head,end=forward?selection.head:selection.anchor;
  const startIndex=Math.min(anchorIndex,headIndex),endIndex=Math.max(anchorIndex,headIndex);
  const crossNode=selection.anchor.id!==selection.head.id;
  const collapsed=!crossNode&&selection.anchor.offset===selection.head.offset;
  function selectedRange(node:HybridNode){
    const index=nodeIndexes.get(node.id);if(nonTextSelection||!nodeIndexes.has(selection.anchor.id)||collapsed||index===undefined||index<startIndex||index>endIndex)return null;
    return (node.kind==='paragraph'||node.kind==='heading')?{from:node.id===start.id?start.offset:0,to:node.id===end.id?end.offset:node.text.length}:{from:0,to:1};
  }
  const [navigation]=useState(createTextNavigation);
  const revealCaret=useRef(false);
  const capture=useRef({value:'',offset:0});
  const [metrics]=useState(()=>({current:createStreamMetrics()}));
  const paused=useRef(streamConfig.paused);
  const pending=useRef<{target:number;count:number;started:number;generationMs:number;renderMs:number;layouts:number;compositionMs:number;done:(work:number)=>void}|null>(null);
  const renderWork=useRef(0),editStarted=useRef<number|null>(null);
  const [reflowTick,setReflowTick]=useState(0);
  const lastReflowTick=useRef(0);
  const [sceneCache]=useState(()=>createHybridScene(owned,minimal?18:20));
  const [zoom,setZoom]=useState(1),[width,setWidth]=useState(620),[scroll,setScroll]=useState(0);
  const [measurements,setMeasurements]=useState(new Map<number,{width:number;height:number}>());
  const measurementsRef=useRef(measurements);measurementsRef.current=measurements;
  const [panel,setPanel]=useState<{kind:'mention'|'comment';nodeId:number;atomId?:string;focus:'text'|'panel'}|null>(null);
  const [focusedWidget,setFocusedWidget]=useState<number|null>(null);
  const [portal,setPortal]=useState<HTMLDivElement|null>(null);
  const [hasFocus,setHasFocus]=useState(false);
  const [inputNotice,setInputNotice]=useState('');
  const scroller=useRef<HTMLDivElement>(null),canvasRef=useRef<HTMLCanvasElement>(null),inputRef=useRef<HTMLTextAreaElement>(null);
  function readScroll(){return minimal?window.scrollY:scroller.current?.scrollTop??0;}
  function scrollDocumentTo(top:number){if(minimal)window.scrollTo({top,behavior:'instant'});else if(scroller.current)scroller.current.scrollTop=top;}
  function openFind(){
    if(!findOpen)returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setPanel(null);setFindOpen(true);setFindFocus(n=>n+1);setFindRequest(n=>n+1);
  }
  function closeFind(){
    findAbort.current?.abort();findInFlight.current=null;setFindSnapshot({state:editor.find.clear(),nodes:editor.state.nodes});setFindOpen(false);
    const target=returnFocus.current;
    const cell=target?.dataset.textBlock;
    const restore=target?.isConnected?target:cell?scroller.current?.querySelector<HTMLElement>(`[data-text-block="${cell}"]`):null;
    if(restore&&restore!==document.body)restore.focus({preventScroll:true});else inputRef.current?.focus({preventScroll:true});
  }
  function moveFind(backwards:boolean){setFindSnapshot({state:backwards?editor.find.previous():editor.find.next(),nodes:editor.state.nodes});setFindRequest(n=>n+1);}
  const selectAll=useCallback(()=>{
    const paragraphs=projectBlocks(editor.state.nodes).nodes.filter(node=>node.kind==='paragraph'||node.kind==='heading');
    const first=paragraphs[0],last=paragraphs.at(-1);
    if(first&&last){
      setEditorState(editor.select(new TextSelection({id:first.id,offset:0},{id:last.id,offset:last.text.length})));
      setPanel(null);inputRef.current?.focus({preventScroll:true});
    }
  },[editor]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.isComposing||event.defaultPrevented)return;
      if(event.target instanceof Element&&event.target!==document.body&&!event.target.closest('.hybrid-shell'))return;
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='a'){
        // The page and toolbar can own focus after loading or switching samples.
        // Editable controls retain their native selection and clipboard behavior.
        if(event.target instanceof Element&&event.target.closest('input,textarea,[contenteditable]:not([contenteditable="false"])'))return;
        event.preventDefault();selectAll();return;
      }
      if(findOpen&&event.key==='Escape'){event.preventDefault();closeFind();return;}
      if(!(event.metaKey||event.ctrlKey)||event.key.toLowerCase()!=='f')return;
      event.preventDefault();openFind();
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[findOpen,selectAll]);
  const composing=useRef(false);
  const current=useRef({nodes,selection,width});current.current={nodes,selection,width};
  const renderer=useRef<{surface:NonNullable<ReturnType<CanvasKit['MakeSWCanvasSurface']>>;paint:Paint}|null>(null);
  const painters=useRef(new Map<string,{paint:Painter;layer:CanvasPaintLayer}>()),drawRef=useRef(()=>{}),frame=useRef(0);
  const schedule=useMemo(()=>()=>{if(frame.current)return;frame.current=requestAnimationFrame(()=>{frame.current=0;drawRef.current();});},[]);
  const register=useMemo(()=>(id:string,painter:Painter,layer:CanvasPaintLayer)=>{painters.current.set(id,{paint:painter,layer});schedule();return()=>{painters.current.delete(id);schedule();};},[schedule]);
  const contentWidth=Math.max(150,width/zoom-56);
  const widthRef=useRef(contentWidth);widthRef.current=contentWidth;
  const onMeasure=useMemo(()=>(id:number,measuredWidth:number,height:number)=>{
    if(measuredWidth!==widthRef.current||!Number.isFinite(height)||height<=0)return;
    setMeasurements(old=>{const value=old.get(id);if(value?.width===measuredWidth&&value.height===height)return old;const next=new Map(old);next.set(id,{width:measuredWidth,height});return next;});
  },[]);
  const scene=useMemo<Scene>(()=>{
    const advance=lastReflowTick.current!==reflowTick;lastReflowTick.current=reflowTick;
    // A background tick can precede the scroll event that updates React state.
    const result=sceneCache.build(nodes,contentWidth,measurements,{top:readScroll()/zoom,height:viewportHeight/zoom,zoom,paddingTop:findOpen?56/zoom:0,pinned:[selection.anchor.id,selection.head.id,...(findBlockId===undefined?[]:[findBlockId]),...(panel?[panel.nodeId]:[]),...(focusedWidget===null?[]:[focusedWidget])],advance,eager:new URLSearchParams(location.search).get('reflow')==='eager',retainAll:new URLSearchParams(location.search).get('retention')==='all'},projection.decorations);
    metrics.current.layoutCalls+=result.layoutIds.length;
    metrics.current.compositionMs+=result.compositionMs;
    metrics.current.lastLayoutIds=result.layoutIds;
    metrics.current.lastSceneMs=result.workMs;
    if(result.reflow)metrics.current.widthChanges.push({blocks:nodes.length,workMs:result.workMs});
    if(result.reflow)metrics.current.reflows.push({generation:result.scene.generation,width:contentWidth,blocks:nodes.length,started:performance.now()-result.workMs,firstPaintMs:0,completeMs:0,initialLayouts:result.layoutIds.length,batches:[]});
    const run=metrics.current.reflows.at(-1);
    if(run&&result.layoutIds.length)run.batches.push({workMs:result.workMs,layouts:result.layoutIds.length,background:result.background,pending:result.scene.pending});
    return result.scene;
  },[nodes,contentWidth,measurements,sceneCache,scroll,zoom,viewportHeight,reflowTick,selection.anchor.id,selection.head.id,panel?.nodeId,focusedWidget,findBlockId,findOpen]);
  const sceneRef=useRef(scene);sceneRef.current=scene;
  const outlinePositions=useMemo(()=>{
    const placements=new Map(scene.placements.map(p=>[p.node.id,p]));
    return outline.flatMap(entry=>{
      let node=tree.byId.get(entry.id);
      while(node&&!placements.has(node.node.id))node=node.parent===null?undefined:tree.byId.get(node.parent);
      const placement=node?placements.get(node.node.id):undefined;
      return placement?[{entry,y:placement.y,placementId:placement.node.id}]:[];
    });
  },[outline,scene.placements,tree]);
  const outlineAvailable=useMemo(()=>new Set(outlinePositions.map(item=>item.entry.key)),[outlinePositions]);
  let outlineActive:string|null=outlinePositions[0]?.entry.key??null;
  for(const item of outlinePositions){if(item.y*zoom>scroll+40)break;outlineActive=item.entry.key;}
  function navigateOutline(entry:OutlineEntry){
    const target=outlinePositions.find(item=>item.entry.key===entry.key);if(!target)return;
    scrollDocumentTo(Math.max(0,target.y*zoom-24));setScroll(readScroll());
    if(target.placementId!==entry.id)requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const element=document.querySelector<HTMLElement>(`[data-text-block="${entry.id}"]`);
      if(element){scrollDocumentTo(Math.max(0,readScroll()+element.getBoundingClientRect().top-toolbarHeight-24));setScroll(readScroll());}
    }));
  }
  const top=scene.top,bottom=top+viewportHeight/zoom;
  const visible=useMemo(()=>{
    const p=scene.placements;let lo=0,hi=p.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(p[mid].y+p[mid].height<top-160)lo=mid+1;else hi=mid;}
    const result:Placement[]=[];for(let i=lo;i<p.length&&p[i].y<bottom+160;i++)result.push(p[i]);
    for(const id of [focusedWidget,panel?.nodeId,findBlockId]){const pinned=p.find(p=>p.node.id===id);if(pinned&&!result.includes(pinned))result.push(pinned);}
    return result.sort((a,b)=>a.y-b.y);
  },[scene,top,bottom,focusedWidget,panel,findBlockId]);
  const findGeometry=useMemo(()=>visible.flatMap(p=>{
    const layout=p.layout;if(!layout)return [];
    return (findMatches.get(p.node.id)??[]).map(match=>({match,rects:layout.geometry(match.from,match.to,false).rects.map((r):Rect=>[r[0],r[1]+p.y,r[2],r[3]+p.y])}));
  }),[visible,findMatches]);
  const active=tree.byId.get(selection.head.id)?.node;
  const activePlacement=scene.placements.find(p=>p.node.id===selection.head.id);
  const caret=activePlacement?.layout?.geometry(selection.head.offset,selection.head.offset,selection.upstream).caret;
  useLayoutEffect(()=>{
    const element=scroller.current;if(!element)return;
    const desired=Math.max(0,scene.top*zoom);
    if(Math.abs(readScroll()-desired)>.1){scrollDocumentTo(desired);setScroll(readScroll());}
  },[scene,zoom]);
  useLayoutEffect(()=>{revealFind.current=true;},[findOpen,findState.active,findRequest]);
  useLayoutEffect(()=>{
    if(!findOpen||!findState.active||!revealFind.current)return;
    const match=findState.active,placement=scene.placements.find(p=>p.node.id===findBlockId);
    if(!placement)return;
    let matchTop:number,matchBottom:number;
    if(placement.layout){
      const rect=placement.layout.geometry(match.from,match.to,false).rects[0];if(!rect)return;
      matchTop=(placement.y+rect[1])*zoom;matchBottom=(placement.y+rect[3])*zoom;
    }else{
      const mark=scroller.current?.querySelector<HTMLElement>('[data-find-active="true"]');
      if(!mark)return;
      // Bring horizontally overflowing table cells into their own scrollport.
      const table=mark.closest('.table-block');
      if(table){const a=mark.getBoundingClientRect(),b=table.getBoundingClientRect();if(a.left<b.left||a.right>b.right)table.scrollLeft+=(a.left-b.left)/zoom-20;}
      const rect=mark.getBoundingClientRect(),viewport=canvasRef.current?.getBoundingClientRect();if(!viewport)return;
      matchTop=rect.top-viewport.top+readScroll();matchBottom=rect.bottom-viewport.top+readScroll();
    }
    revealFind.current=false;
    const scrollTop=readScroll(),clearance=64;
    if(matchTop<scrollTop+clearance||matchBottom>scrollTop+viewportHeight-24){
      scrollDocumentTo(Math.max(0,matchTop-Math.max(clearance,viewportHeight*.35)));setScroll(readScroll());
    }
  },[scene,findOpen,findState.active,findRequest,findBlockId,zoom,viewportHeight]);
  useEffect(()=>{
    if(!scene.pending)return;
    const frame=requestAnimationFrame(()=>setReflowTick(t=>t+1));
    return()=>cancelAnimationFrame(frame);
  },[scene,reflowTick]);
  useLayoutEffect(()=>{
    const el=scroller.current;if(!el)return;
    const measure=()=>{setWidth(el.clientWidth);setToolbarHeight(toolbarRef.current?.offsetHeight??50);setViewportHeight(minimal?Math.max(1,window.innerHeight-(toolbarRef.current?.offsetHeight??50)):el.clientHeight);};
    const onPageScroll=()=>setScroll(window.scrollY);
    const observer=new ResizeObserver(measure);observer.observe(el);if(toolbarRef.current)observer.observe(toolbarRef.current);measure();
    if(minimal){window.addEventListener('scroll',onPageScroll,{passive:true});window.addEventListener('resize',measure);}
    return()=>{observer.disconnect();window.removeEventListener('scroll',onPageScroll);window.removeEventListener('resize',measure);};
  },[]);
  useEffect(()=>{
    const close=(event:PointerEvent|KeyboardEvent)=>{
      for(const menu of toolbarRef.current?.querySelectorAll('details[open]')??[]){
        if(event instanceof KeyboardEvent){if(event.key!=='Escape')continue;menu.removeAttribute('open');menu.querySelector('summary')?.focus();}
        else if(event.target instanceof Node&&!menu.contains(event.target))menu.removeAttribute('open');
      }
    };
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};
  },[]);
  useLayoutEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const dpr=window.devicePixelRatio||1;canvas.width=Math.round(width*dpr);canvas.height=Math.round(viewportHeight*dpr);
    const surface=kit.MakeSWCanvasSurface(canvas);if(!surface)throw new Error('Canvas unavailable');
    const paint=new kit.Paint();paint.setAntiAlias(true);
    renderer.current={surface,paint};
    return()=>{renderer.current=null;surface.dispose();paint.delete();};
  },[kit,width,viewportHeight]);
  useLayoutEffect(()=>{
    drawRef.current=()=>{
      const target=renderer.current;if(!target)return;
      const {surface,paint}=target;
      const dpr=window.devicePixelRatio||1;
      const paintStarted=performance.now();let submitted=0;
      const c=surface.getCanvas();c.clear(minimal?kit.Color(255,255,255):kit.Color(255,254,249));c.save();c.scale(dpr*zoom,dpr*zoom);c.translate(28,-top);
      for(const painter of painters.current.values())if(painter.layer==='background')painter.paint(c,kit,paint);
      paint.setColor(kit.Color(194,216,235));
      for(const p of visible){const range=selectedRange(p.node);if(!range||!p.layout)continue;
        for(const r of p.layout.geometry(range.from,range.to,false).rects)c.drawRect(kit.XYWHRect(r[0],r[1]+p.y,r[2]-r[0],r[3]-r[1]),paint);
      }
      for(const {match,rects} of findGeometry){
        paint.setColor(match===findState.active?kit.Color(245,185,65):kit.Color(255,236,151));
        for(const r of rects)c.drawRect(kit.XYWHRect(r[0],r[1],r[2]-r[0],r[3]-r[1]),paint);
      }
      for(const p of visible)if(p.layout&&p.y+p.height>top-80&&p.y<bottom+80){submitted++;if(p.layout.drawViewport)p.layout.drawViewport(c,0,p.y,top-p.y-80,bottom-p.y+80);else p.layout.draw(c,0,p.y);}
      for(const painter of painters.current.values())if(painter.layer==='content')painter.paint(c,kit,paint);
      if(caret&&activePlacement&&hasFocus){paint.setColor(kit.Color(35,48,31));c.drawRect(kit.XYWHRect(caret[0],caret[1]+activePlacement.y,1,caret[3]-caret[1]),paint);}
      c.restore();surface.flush();
      const now=performance.now(),m=metrics.current,drawMs=now-paintStarted;
      if(m.paints.length<10000)m.paints.push(drawMs);m.maxMounted=Math.max(m.maxMounted,visible.filter(p=>(p.node.kind!=='paragraph'&&p.node.kind!=='heading')).length);m.maxSubmitted=Math.max(m.maxSubmitted,submitted);
      const reflow=metrics.current.reflows.at(-1);
      if(reflow&&reflow.generation===scene.generation){
        if(!reflow.firstPaintMs)reflow.firstPaintMs=now-reflow.started;
        if(!scene.pending&&!reflow.completeMs)reflow.completeMs=now-reflow.started;
      }
      if(visible.some(p=>(p.node.kind==='paragraph'||p.node.kind==='heading')&&(!p.layout||p.layoutWidth!==scene.width)))m.stalePaints++;
      if(editStarted.current!==null){m.editPaintMs.push(now-editStarted.current);editStarted.current=null;}
      if(!m.firstCanvasFlushMs){m.firstCanvasFlushMs=now;m.firstLoaded=nodes.length;}
      const batch=pending.current;
      if(batch&&editorState.revision>=batch.target){
        const work=batch.renderMs+drawMs+batch.generationMs;
        m.samples.push({loaded:nodes.length,count:batch.count,workMs:work,elapsedMs:now-batch.started,layouts:m.layoutCalls-batch.layouts});
        pending.current=null;batch.done(m.compositionMs-batch.compositionMs);
      }
      if(sample.total&&sourceLoaded.current===sample.total&&editorState.revision>=sourceRevision.current&&!m.completedAt)m.completedAt=now;
    };
    schedule();return()=>{drawRef.current=()=>{};};
  },[kit,width,zoom,scroll,scene,visible,selection,activePlacement,caret?.join(','),hasFocus,schedule,top,bottom,findGeometry,findState.active]);
  useLayoutEffect(()=>{renderWork.current=performance.now()-renderStarted;if(pending.current)pending.current.renderMs+=renderWork.current;});
  function syncInput(){
    const input=inputRef.current,value=editor.state.selection;if(!input||!(value instanceof TextSelection))return;
    if(value.anchor.id!==value.head.id){
      const a=nodes.findIndex(node=>node.id===value.anchor.id),h=nodes.findIndex(node=>node.id===value.head.id),first=a<h?value.anchor:value.head;
      input.value='';input.setSelectionRange(0,0);capture.current={value:'',offset:first.offset};
    }else{
      const node=indexTree(demoSchema,editor.state.nodes).byId.get(value.head.id)?.node;if((node?.kind!=='paragraph'&&node?.kind!=='heading'))return;
      input.value=node.text;input.setSelectionRange(Math.min(value.anchor.offset,value.head.offset),Math.max(value.anchor.offset,value.head.offset));capture.current={value:node.text,offset:0};
    }
  }
  useLayoutEffect(()=>{
    const input=inputRef.current,canvas=canvasRef.current;if(!input||!canvas)return;
    // Native typing reveals the focused input even after focus({preventScroll:true}).
    // Keep the input in viewport coordinates, near the canvas caret, so revealing
    // it cannot scroll the page back to the document's origin.
    const bounds=canvas.getBoundingClientRect();
    const x=bounds.left+((caret?.[0]??0)+28)*zoom;
    const y=bounds.top+(activePlacement?activePlacement.y*zoom-readScroll():0)+(caret?.[1]??0)*zoom;
    input.style.left=`${Math.max(0,Math.min(window.innerWidth-2,x))}px`;
    input.style.top=`${Math.max(0,Math.min(window.innerHeight-2,Math.max(bounds.top,Math.min(bounds.bottom-2,y))))}px`;
  },[caret?.join(','),activePlacement,scroll,zoom,width,viewportHeight]);
  useLayoutEffect(()=>{if(!composing.current)syncInput();},[active,selection]);
  useEffect(()=>{
    const input=inputRef.current;if(!input)return;
    const nativeSelect=()=>{
      const value=editor.state.selection;
      // Safari's native Select All can bypass keydown and React's selection
      // plugin. Observe the capture input's native select event directly.
      if(composing.current||!input.value||input.selectionStart!==0||input.selectionEnd!==input.value.length||!(value instanceof TextSelection)||value.anchor.id!==value.head.id)return;
      // Ignore syncInput echoes, including deliberate paragraph selections.
      if(Math.min(value.anchor.offset,value.head.offset)===0&&Math.max(value.anchor.offset,value.head.offset)===input.value.length)return;
      selectAll();
    };
    input.addEventListener('select',nativeSelect);
    return()=>input.removeEventListener('select',nativeSelect);
  },[editor,selectAll]);
  useEffect(()=>{
    let cancelled=false,raf=0,last=performance.now();
    function sampleFrame(now:number){if(!metrics.current.completedAt&&metrics.current.frames.length<30000)metrics.current.frames.push({at:now,gapMs:now-last});last=now;if(!metrics.current.completedAt&&metrics.current.frames.length<30000)raf=requestAnimationFrame(sampleFrame);}
    if(sample.total)raf=requestAnimationFrame(sampleFrame);
    async function load(){
      if(!sample.total)return;
      // First paint is usable before producing the next chunk.
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      let cursor=sample.initial.length,batch=32;
      while(cursor<sample.total&&!cancelled){
        while(paused.current&&!cancelled)await new Promise(resolve=>setTimeout(resolve,16));
        if(cancelled)return;
        const count=Math.min(batch,sample.total-cursor),started=performance.now();
        const chunk=sample.chunk(cursor,count),generationMs=performance.now()-started;
        const layoutWork=await new Promise<number>(done=>{
          const result=editor.dispatch({baseRevision:editor.state.revision,origin:'stream',history:'exclude',steps:[{kind:'append',nodes:chunk}]});
          sourceLoaded.current=cursor+count;sourceRevision.current=result.state.revision;
          pending.current={target:result.state.revision,count,started,generationMs,renderMs:0,layouts:metrics.current.layoutCalls,compositionMs:metrics.current.compositionMs,done};
          setEditorState(result.state);
        });
        cursor+=count;
        // Only new paragraph composition scales with batch size. Including the
        // growing document's bookkeeping here shrank batches to eight nodes,
        // multiplying that same bookkeeping across thousands of frames.
        batch=Math.max(8,Math.min(128,Math.floor(count*Math.max(.5,Math.min(2,8/Math.max(.1,layoutWork))))));
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    void load();
    return()=>{cancelled=true;cancelAnimationFrame(raf);pending.current?.done(0);pending.current=null;if(frame.current)cancelAnimationFrame(frame.current);sceneCache.clear();owned.engine.clear();};
  },[owned,sceneCache,sample]);
  function dispatch(steps:Step<HybridNode>[],history:Transaction<HybridNode>['history']='separate',nextSelection?:Selection){
    if(history==='exclude')throw new Error('Local commands must declare a history group');
    try{
      const result=editor.dispatch({baseRevision:editor.state.revision,origin:'local',history,time:performance.now(),steps,selection:nextSelection});
      editStarted.current=performance.now();setInputNotice('');setEditorState(result.state);return true;
    }catch(error){
      setInputNotice(error instanceof Error?error.message:'Edit failed');
      syncInput();
      return false;
    }
  }
  const formatting=textCommands(demoSchema,editorState,tree);
  const formatActive=formatting.active;
  function toggleFormat(key:TextFormat){
    if(!formatting.available)return;
    dispatch(formatting.toggle(key),'separate',editorState.selection);inputRef.current?.focus({preventScroll:true});
  }
  function clearMarks(){dispatch(formatting.clear(),'separate',editorState.selection);inputRef.current?.focus({preventScroll:true});}
  function addComment(){
    const command=formatting.comment(crypto.randomUUID());if(!command.target)return;
    if(dispatch(command.steps,'separate',selection))setPanel({kind:'comment',nodeId:command.target.nodeId,atomId:command.target.commentId,focus:'panel'});
  }
  const allocate=()=>({id:editor.allocateBlockId(),key:crypto.randomUUID()});
  const selectedBlocks=(nodeIndexes.has(selection.head.id)?nodes.slice(startIndex,endIndex+1):[]).filter(node=>node.id!==end.id||end.offset>0||collapsed||start.id===end.id);
  const blockLabel=selectedBlockLabel(demoSchema,editorState,tree);
  const blocks=blockCommands(demoSchema,editorState,selectedBlocks.map(n=>n.id),allocate,tree);
  function structure(action:()=>Step<HybridNode>[]){
    try{dispatch(action(),'separate',editorState.selection);}catch(error){setInputNotice(error instanceof Error?error.message:'Cannot change these blocks');}
    inputRef.current?.focus({preventScroll:true});
  }
  function selectedTable(){
    let entry=tree.byId.get(editorState.selection instanceof tableCells.CellSelection?editorState.selection.tableId:selection.head.id);
    while(entry){if(entry.node.kind==='table')return entry;entry=entry.parent===null?undefined:tree.byId.get(entry.parent);}
  }
  function changeTable(column:boolean){const entry=selectedTable();if(!entry||entry.node.kind!=='table')return;const table=entry.node;structure(()=>[{kind:'replaceChildren',parent:entry.parent,index:entry.index,count:1,nodes:[(column?appendTableColumn:appendTableRow)(table,allocate)]}]);}
  function insertTable(){
    let entry=tree.byId.get(selection.head.id);while(entry?.parent!=null)entry=tree.byId.get(entry.parent);
    if(!entry)return;
    const table=createTable(allocate),after:HybridNode={kind:'paragraph',...allocate(),text:'',spans:[],atoms:[],comments:[]};
    dispatch([{kind:'insertChildren',parent:null,index:entry.index+1,nodes:[table,after]}],'separate',textSelection(after.id,0));
  }
  function replaceCells(text:string){
    try{const command=editor.selectionEdit(text);dispatch(command.steps,'separate',command.selection);}catch(error){setInputNotice(String(error));}
  }
  function setHeading(level:1|2|3|4|null){
    const steps=setTextBlockType(demoSchema,editorState,selectedBlocks.map(n=>n.id),level,tree);
    dispatch(steps,'separate',editorState.selection);inputRef.current?.focus({preventScroll:true});
  }
  function update(node:HybridNode){dispatch([{kind:'updateBlock',node}]);}
  function restore(redo=false){
    const result=redo?editor.redo():editor.undo();if(!result)return;
    editStarted.current=performance.now();setEditorState(result.state);
    setPanel(null);inputRef.current?.focus({preventScroll:true});
  }
  function replace(from:number,to:number,value:string,separate=false,paragraphs=false){
    if((active?.kind!=='paragraph'&&active?.kind!=='heading'))return;
    function reject(message:string){
      setInputNotice(message);
      syncInput();
    }
    const normalized=value.replace(/\r\n?/g,'\n').replace(/\t/g,' ').replaceAll('\ufffc','');
    const clean=paragraphs?normalized:normalized.replace(/\n/g,' ');
    if(!supportsOwnedText(clean)){
      reject('This study currently supports Latin text.');return;
    }
    if(paragraphs&&clean.includes('\n')){const command=pasteParagraphs(demoSchema,editorState,clean,allocate);dispatch(command.steps,'separate',command.selection);setPanel(null);return;}
    if(crossNode){const command=replaceStructuredText(demoSchema,editorState,clean);const history=separate?'separate':{group:`${composing.current?'composition':clean?'typing':'delete'}:${start.id}`};dispatch(command.steps,history,command.selection);setPanel(null);return;}
    const nextSelection=textSelection(active.id,from+clean.length);
    const history=separate?'separate':{group:`${composing.current?'composition':clean?'typing':'delete'}:${active.id}`};
    dispatch([{kind:'replaceText',id:active.id,from,to,text:clean}],history,nextSelection);
  }

  function copyText(){return nodes.slice(startIndex,endIndex+1).map(node=>{
    const range=selectedRange(node);if(!range)return '';
    return (node.kind==='paragraph'||node.kind==='heading')?plainText(node,range.from,range.to):node.kind==='image'?node.alt:node.kind==='table'?tablePlainText(node):node.notes||'[Checklist]';
  }).join('\n');}

  function closePanel(){setPanel(null);inputRef.current?.focus({preventScroll:true});}
  function key(event:React.KeyboardEvent<HTMLTextAreaElement>){
    if(event.nativeEvent.isComposing||composing.current)return;
    if(nonTextSelection&&(event.key==='Backspace'||event.key==='Delete')){event.preventDefault();replaceCells('');return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();restore(event.shiftKey);return;}
    if((event.metaKey||event.ctrlKey)&&['b','i','u'].includes(event.key.toLowerCase())){event.preventDefault();toggleFormat(event.key.toLowerCase()==='b'?'bold':event.key.toLowerCase()==='i'?'italic':'underline');return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='a'){
      event.preventDefault();selectAll();return;
    }
    if(event.key==='Escape'){event.preventDefault();if(findOpen)closeFind();else closePanel();return;}
    const moved=/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)?navigation.move({event,selection,blocks:scene.placements.flatMap(p=>p.node.kind==='paragraph'||p.node.kind==='heading'?[{id:p.node.id,text:p.node.text,top:p.y,height:p.height}]:[]),layout:id=>sceneCache.layoutFor(id),viewportHeight:viewportHeight/zoom,platform:/Mac|iPhone|iPad/.test(navigator.platform)?'mac':'other'}):null;
    if(moved){event.preventDefault();editor.breakHistory();revealCaret.current=true;setSelection(moved);return;}
    if(event.key==='Backspace'||event.key==='Delete'){
      event.preventDefault();if(crossNode){replace(0,0,'',true);return;}let from=Math.min(selection.anchor.offset,selection.head.offset),to=Math.max(selection.anchor.offset,selection.head.offset);
      if(from===to&&(active?.kind==='paragraph'||active?.kind==='heading')){const b=boundaries(active.text),i=b.indexOf(from);if(event.key==='Backspace')from=b[Math.max(0,i-1)];else to=b[Math.min(b.length-1,i+1)];}
      if(from===to&&(active?.kind==='paragraph'||active?.kind==='heading')){
        const index=nodes.findIndex(n=>n.id===active.id),back=event.key==='Backspace';
        if(back&&blocks.item!==undefined){try{const command=listCommands.backspace(demoSchema,editorState,active.id,allocate);dispatch(command.steps,'separate',command.selection);}catch(error){setInputNotice(String(error));}return;}
        const neighbour=nodes[index+(back?-1:1)];
        if((neighbour?.kind==='paragraph'||neighbour?.kind==='heading')&&(back?from===0:to===active.text.length)){
          const left=back?neighbour:active,right=back?active:neighbour,at=left.text.length;
          dispatch([{kind:'join',left:left.id,right:right.id}],'separate',textSelection(left.id,at));return;
        }
      }
      if(from!==to)replace(from,to,'');
    }
    if(event.key==='Tab'&&blocks.item!==undefined){event.preventDefault();structure(()=>(event.shiftKey?listCommands.outdent:listCommands.indent)(demoSchema,editorState,blocks.item!,allocate).steps);return;}
    if(event.key==='Enter'&&(active?.kind==='paragraph'||active?.kind==='heading')){
      if(collapsed&&blocks.item!==undefined){event.preventDefault();try{const command=listCommands.enter(demoSchema,editorState,active.id,selection.head.offset,allocate);dispatch(command.steps,'separate',command.selection);}catch(error){setInputNotice(String(error));}return;}
      const parent=tree.byId.get(active.id)?.parent;
      if(collapsed&&!active.text&&parent!=null&&tree.byId.get(parent)?.node.kind==='quote'){event.preventDefault();structure(()=>[{kind:'unwrap',id:parent}]);return;}
      event.preventDefault();const rightId=editor.allocateBlockId();
      const command=collapsed?{steps:[],selection}:replaceStructuredText(demoSchema,editorState,'');
      const caret=command.selection;if(!(caret instanceof TextSelection))throw new Error('Text replacement must return a caret');
      const steps:Step<HybridNode>[]=[...command.steps,{kind:'split',id:caret.head.id,at:caret.head.offset,rightId,rightKey:crypto.randomUUID()}];
      dispatch(steps,'separate',textSelection(rightId,0));setPanel(null);
    }
  }
  const panelPlacement=scene.placements.find(p=>p.node.id===panel?.nodeId);
  let panelRect:Rect|null=null;
  if(panel&&panelPlacement){if(panel.kind==='mention'){const box=panelPlacement.boxes.find(b=>b.id===panel.atomId);if(box)panelRect=[box.x,box.y+panelPlacement.y,box.x+box.width,box.y+box.height+panelPlacement.y];}
    else if((panelPlacement.node.kind==='paragraph'||panelPlacement.node.kind==='heading')&&panelPlacement.layout){const range=panelPlacement.node.comments.find(c=>c.id===panel.atomId);const r=range&&panelPlacement.layout.geometry(range.start,range.end,false).rects[0];if(r)panelRect=[r[0],r[1]+panelPlacement.y,r[2],r[3]+panelPlacement.y];}}
  useEffect(()=>{if(panel?.focus==='panel')portal?.querySelector<HTMLButtonElement>('.close-panel')?.focus({preventScroll:true});},[panel?.kind,panel?.nodeId,panel?.atomId,panel?.focus,portal]);
  useEffect(()=>{
    Object.assign(window,{hybridSpike:{
      anchor:(id:number,offset:number,bias:-1|1)=>createAnchor(demoSchema,editor.state,'hybrid-demo',id,offset,bias),
      resolveAnchor:(value:unknown)=>resolveAnchor(demoSchema,parseAnchor(value),'hybrid-demo',editor.state,editor.journal),
      history:()=>editor.history,
      find:()=>findRef.current,
      checkTransactions,checkExtensions,checkContainers,checkSelections,benchmarkContainerEdits,importHtml,
      verifyReflow:()=>checkReflow(kit,current.current.nodes,sceneRef.current,measurementsRef.current),
      pause:()=>{paused.current=true;},resume:()=>{paused.current=false;},
      metrics:()=>({...metrics.current,cachedParagraphs:sceneCache.cachedParagraphs,residentParagraphs:sceneCache.residentParagraphs,retention:owned.retention(),memory:owned.memory()}),
      probe:(ids:number[])=>({reflowPending:sceneRef.current.pending,generation:sceneRef.current.generation,stalePaints:metrics.current.stalePaints,count:current.current.nodes.length,selection:{id:current.current.selection.head.id,anchorId:current.current.selection.anchor.id,anchor:current.current.selection.anchor.offset,focus:current.current.selection.head.offset,upstream:current.current.selection.upstream},stats:{...owned.stats},paused:paused.current,complete:!!metrics.current.completedAt,scroll:readScroll(),zoom,width:widthRef.current,mounted:[...document.querySelectorAll('[data-widget], [data-image]')].map(n=>Number(n.getAttribute('data-widget')??n.getAttribute('data-image'))),nodes:current.current.nodes.filter(n=>ids.includes(n.id)),scene:sceneRef.current.placements.filter(p=>ids.includes(p.node.id)).map(p=>({id:p.node.id,y:p.y,height:p.height,layoutWidth:p.layoutWidth,boxes:p.boxes})),layoutCalls:metrics.current.layoutCalls,lastLayoutIds:metrics.current.lastLayoutIds}),
      scrollTo:(id:number,offset=0)=>{const p=sceneRef.current.placements.find(p=>p.node.id===id);if(p)scrollDocumentTo((p.y+offset)*zoom);},
      checkInline:()=>checkInline(owned),read:()=>({nodes:current.current.nodes,selection:{id:current.current.selection.head.id,anchorId:current.current.selection.anchor.id,anchor:current.current.selection.anchor.offset,focus:current.current.selection.head.offset,upstream:current.current.selection.upstream},scene:sceneRef.current.placements.map(p=>({id:p.node.id,y:p.y,height:p.height,layoutWidth:p.layoutWidth,boxes:p.boxes})),stats:{...owned.stats},mounted:[...document.querySelectorAll('[data-widget]')].map(n=>n.getAttribute('data-widget')),zoom,width:widthRef.current,scroll:readScroll(),paintCount:painters.current.size}),select:(id:number,index:number)=>{setSelection(textSelection(id,index));inputRef.current?.focus({preventScroll:true});}}});
  },[owned,zoom]);
  const pointerSelection=usePointerSelection({
    selection,onSelect:next=>{navigation.reset();setSelection(next);},focus:()=>inputRef.current?.focus({preventScroll:true}),
    hitTest(clientX,clientY){
      const canvas=canvasRef.current;if(!canvas)return null;
      const bounds=canvas.getBoundingClientRect(),x=(clientX-bounds.left)/zoom-28,y=(clientY-bounds.top+readScroll())/zoom;
      function* regions():Iterable<TextHitRegion>{for(const p of scene.placements)if(p.layout)yield {id:p.node.id,top:p.y,lines:p.layout.lines,hit:p.layout.hit};}
      return hitTestTextLines(regions(),x,y);
    },
    selectRange(hit,clicks){
      const node=tree.byId.get(hit.point.id)?.node;if(!node||(node.kind!=='paragraph'&&node.kind!=='heading')||clicks<2)return null;
      const range=clicks>=3?{from:0,to:node.text.length}:wordRange(node.text,hit.point.offset-(hit.upstream?1:0));
      return new TextSelection({id:node.id,offset:range.from},{id:node.id,offset:range.to});
    },
    onStart(hit,clicks){
      const node=tree.byId.get(hit.point.id)?.node;
      const comment=clicks===1&&(node?.kind==='paragraph'||node?.kind==='heading')?node.comments.find(c=>hit.point.offset>=c.start&&hit.point.offset<=c.end):undefined;
      setPanel(comment?{kind:'comment',nodeId:hit.point.id,atomId:comment.id,focus:'text'}:null);
    },onDrag:()=>setPanel(null),
  });
  useLayoutEffect(()=>{
    if(!revealCaret.current||!activePlacement||!caret)return;
    revealCaret.current=false;
    const top=activePlacement.y*zoom+caret[1]*zoom,bottom=activePlacement.y*zoom+caret[3]*zoom,currentScroll=readScroll();
    const target=top<currentScroll+8?top-8:bottom>currentScroll+viewportHeight-8?bottom-viewportHeight+8:currentScroll;
    if(target!==currentScroll){scrollDocumentTo(Math.max(0,target));setScroll(readScroll());}
  },[selection,activePlacement,caret,viewportHeight,zoom]);
  const quoteRules=new Map<number,{top:number;bottom:number;left:number}>();
  for(const p of visible)for(const quote of projection.decorations.get(p.node.id)?.quotes??[]){
    const prior=quoteRules.get(quote.id);quoteRules.set(quote.id,{top:prior?.top??p.y,bottom:p.y+p.height,left:quote.inset});
  }
  return <TeamContext.Provider value="Design team"><CanvasLayerProvider value={register}>
    <main className="hybrid-shell">{minimal?<header ref={toolbarRef} className="minimal-toolbar" aria-label="Formatting" role="toolbar">
      <div className="toolbar-inner">
        <details className="blocks-menu" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label={`Block type: ${blockLabel}`}><span>{blockLabel}</span></summary><div role="group" aria-label="Block commands" onClick={e=>e.currentTarget.parentElement?.removeAttribute('open')}>
          <button disabled={!selectedBlocks.some(n=>n.kind==='paragraph'||n.kind==='heading')} onClick={()=>setHeading(null)}>Paragraph</button>
          {([1,2,3,4] as const).map(level=><button key={level} disabled={!selectedBlocks.some(n=>n.kind==='paragraph'||n.kind==='heading')} aria-pressed={active?.kind==='heading'&&active.level===level} onClick={()=>setHeading(level)}>Heading {level}</button>)}




          <button disabled={!selectedBlocks.length} onClick={()=>structure(()=>blocks.list(false))}>Bullet list</button>
          <button disabled={!selectedBlocks.length} onClick={()=>structure(()=>blocks.list(true))}>Numbered list</button>


        </div></details>
        <span className="toolbar-divider"/>
        <button aria-label="Bold" title="Bold selected text (⌘B)" aria-pressed={formatActive('bold')} disabled={!formatting.available} onMouseDown={e=>e.preventDefault()} onClick={()=>toggleFormat('bold')}><b>B</b></button>
        <button aria-label="Italic" title="Italic selected text (⌘I)" aria-pressed={formatActive('italic')} disabled={!formatting.available} onMouseDown={e=>e.preventDefault()} onClick={()=>toggleFormat('italic')}><i>I</i></button>
        <button aria-label="Underline" title="Underline selected text" aria-pressed={formatActive('underline')} disabled={!formatting.available} onMouseDown={e=>e.preventDefault()} onClick={()=>toggleFormat('underline')}><u>U</u></button>
        <button aria-label="Clear formatting" title="Clear formatting" disabled={!formatting.available} onMouseDown={e=>e.preventDefault()} onClick={clearMarks}>Tx</button>
        <button aria-label="Add comment" title="Comment on selection" disabled={!formatting.available||!nodeIndexes.has(selection.head.id)} onMouseDown={e=>e.preventDefault()} onClick={addComment}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11v6a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2h8M19 2v6M16 5h6"/></svg></button>

          <button aria-label="Block quote" title="Block quote" aria-pressed={blocks.quoted} disabled={!selectedBlocks.length} onClick={()=>structure(()=>blocks.quote())}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 6H4v7h6V6Zm10 0h-6v7h6V6ZM10 13c0 4-2 5-5 5m15-5c0 4-2 5-5 5"/></svg></button>
          <button aria-label="Indent list item" title="Indent list item" disabled={blocks.item===undefined} onClick={()=>structure(()=>listCommands.indent(demoSchema,editorState,blocks.item!,allocate).steps)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5h9M12 12h9M12 19h9M3 8l4 4-4 4"/></svg></button>
          <button aria-label="Outdent list item" title="Outdent list item" disabled={blocks.item===undefined} onClick={()=>structure(()=>listCommands.outdent(demoSchema,editorState,blocks.item!,allocate).steps)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5h9M12 12h9M12 19h9M7 8l-4 4 4 4"/></svg></button>
<details className="table-menu"><summary aria-label="Table" title="Table"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3h18v18H3zM3 9h18M9 3v18"/></svg></summary><div role="group" aria-label="Table commands" onClick={e=>e.currentTarget.parentElement?.removeAttribute("open")}><button onClick={insertTable}>Table (3 × 3)</button>{selectedTable()&&<button onClick={()=>changeTable(false)}>Add table row</button>}{selectedTable()&&<button onClick={()=>changeTable(true)}>Add table column</button>}</div></details>
        <div className="toolbar-trailing">
        <button aria-label="Find" title="Find in document (⌘F / Ctrl+F)" aria-expanded={findOpen} onClick={openFind}><FindIcon/></button>
        <select className="sample-picker" aria-label="Sample" value={bookSamples.some(book=>book.id===sample.id)?sample.id:'minimal'} disabled={loading} onChange={e=>onSampleChange(e.target.value)}>
          <option value="minimal">Draft</option>{bookSamples.map(book=><option key={book.id} value={book.id}>{book.title}</option>)}
        </select>
        <button aria-label="Undo" title="Undo (⌘Z)" disabled={!editor.history.undo} onClick={()=>restore()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 4-5 5 5 5M4 9h9a7 7 0 0 1 0 14"/></svg></button>
        <button aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!editor.history.redo} onClick={()=>restore(true)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 4 5 5-5 5M20 9h-9a7 7 0 0 0 0 14"/></svg></button>
        </div>
      </div>
    </header>:<header className="app-header"><strong>gprose <span> / Extension study</span></strong><div><label>Sample <select value={sample.id} disabled={loading} onChange={e=>onSampleChange(e.target.value)}><option value="extensions">Launch notes</option><option value="stream">10,000 mixed blocks</option>{bookSamples.map(book=><option key={book.id} value={book.id}>{book.title}</option>)}</select></label><button aria-label="Find" aria-expanded={findOpen} onClick={openFind}><FindIcon/></button><button onClick={()=>restore()}>Undo</button><button onClick={()=>restore(true)}>Redo</button><label>Zoom <select value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={1.25}>125%</option><option value={1.5}>150%</option></select></label></div></header>}
      {!minimal&&<div className="document-heading"><h1>{sample.title}</h1>{sample.description&&<p>{sample.description}</p>}</div>}
      {minimal&&<OutlineMenu availableKeys={outlineAvailable} entries={outline} activeKey={outlineActive} onNavigate={navigateOutline} toolbarHeight={toolbarHeight}/>}
      <div className="editor-surface" {...pointerSelection}><div className="editor-frame" onKeyDown={e=>{if(e.key==='Escape'&&panel){e.preventDefault();closePanel();}}}>
        {findOpen&&<div className="find-anchor" style={{top:minimal?toolbarHeight:0}}><FindBar state={findState} initialQuery={lastQuery.current} initialOptions={lastFindOptions.current} stale={findStale} focusRequest={findFocus} onQuery={requestFind} onMove={moveFind} onClose={closeFind}/></div>}
        <div className="document-scroll" ref={scroller} onScroll={e=>{if(!minimal)setScroll(e.currentTarget.scrollTop);}}>
          <div className="document-space" style={{height:Math.max(scene.height*zoom,viewportHeight)}}>
            <canvas ref={canvasRef} style={{width,height:viewportHeight,top:minimal?toolbarHeight:undefined}} aria-label="Canvas document"/>
            <div className="dom-layer" style={{width:width/zoom,height:scene.height,transform:`scale(${zoom})`}}>
              {[...quoteRules].map(([id,rule])=><span key={`quote-${id}`} data-quote={id} className="quote-rule" style={{left:28+rule.left,top:rule.top,bottom:'auto',height:rule.bottom-rule.top,pointerEvents:'none'}}/>)}
              {visible.map(p=>{const d=projection.decorations.get(p.node.id);return d?.marker?<div key={`structure-${p.node.id}`} className="block-decoration" data-block-decoration={p.node.id} style={{left:28,top:p.y,height:p.height,width:d.inset}}><span className="list-marker">{d.marker}</span></div>:null;})}
              {visible.map(p=>p.node.kind==='table'?<div onFocusCapture={()=>setFocusedWidget(p.node.id)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocusedWidget(null);}} key={p.node.id} className="block-position" data-selected={!!selectedRange(p.node)} style={{left:28,top:p.y,width:contentWidth}}><TableBlock findMatches={findMatches} activeMatch={findOpen?findState.active:null} node={p.node} width={contentWidth} onMeasure={onMeasure} selection={editorState.selection} context={context} onSelect={setSelection} onText={(id,from,to,text,caret)=>dispatch([{kind:'replaceText',id,from,to,text}],{group:`typing:${id}`},textSelection(id,caret))} onUndo={restore} onFormat={toggleFormat} onReplace={replaceCells}/></div>:p.node.kind==='image'?<div key={p.node.id} className="block-position" data-selected={!!selectedRange(p.node)} style={{left:28,top:p.y,width:contentWidth}}><ImageBlock node={p.node} width={contentWidth} onMeasure={onMeasure}/></div>:p.node.kind==='checklist'?<div key={p.node.id} className="block-position" data-selected={!!selectedRange(p.node)} style={{left:28,top:p.y,width:contentWidth}} onFocusCapture={()=>setFocusedWidget(p.node.id)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocusedWidget(null);}}><Checklist node={p.node} width={contentWidth} onChange={update} onMeasure={onMeasure}/></div>:<ParagraphExtensions key={p.node.id} placement={p} kit={kit} owned={owned} open={(kind,atomId,index)=>{setSelection(textSelection(p.node.id,index));setPanel({kind,nodeId:p.node.id,atomId,focus:'panel'});}}/>) }
            </div>
          </div>
        </div>
        <textarea ref={inputRef} className="text-capture" tabIndex={-1} aria-label="Canvas text input" autoComplete="off" spellCheck={false} onFocus={()=>setHasFocus(true)} onBlur={()=>setHasFocus(false)} onKeyDown={key} onCompositionStart={()=>{editor.breakHistory();composing.current=true;}} onCompositionEnd={()=>{composing.current=false;editor.breakHistory();requestAnimationFrame(()=>syncInput());}} onInput={e=>{
          if((active?.kind!=='paragraph'&&active?.kind!=='heading'))return;const value=e.currentTarget.value,old=capture.current.value,offset=capture.current.offset;
          if(!collapsed&&!crossNode){capture.current={value,offset};replace(start.offset,end.offset,value.slice(start.offset,value.length-(old.length-end.offset)));return;}
          let from=0;while(from<old.length&&from<value.length&&old[from]===value[from])from++;
          let oldEnd=old.length,tail=value.length;while(oldEnd>from&&tail>from&&old[oldEnd-1]===value[tail-1]){oldEnd--;tail--;}
          capture.current={value,offset};replace(offset+from,offset+oldEnd,value.slice(from,tail));
        }} onCopy={e=>{e.preventDefault();writeClipboard(e.clipboardData,demoSchema,editorState,copyText());}} onCut={e=>{e.preventDefault();writeClipboard(e.clipboardData,demoSchema,editorState,copyText());if(!collapsed)replace(start.offset,end.offset,'',true);}} onPaste={e=>{e.preventDefault();try{const fragment=readClipboard(e.clipboardData);if(fragment){const command=pasteFragment(demoSchema,editorState,fragment,allocate);dispatch(command.steps,'separate',command.selection);setPanel(null);}else replace(start.offset,end.offset,e.clipboardData.getData('text/plain'),true,true);}catch(error){setInputNotice(error instanceof Error?error.message:String(error));}}}/>
        <div className="panel-layer" ref={setPortal}/>
        {portal&&panel&&panelRect&&panelRect[3]*zoom-scroll>=0&&panelRect[1]*zoom-scroll<=viewportHeight&&createPortal(<div className="nearby-panel" role="dialog" aria-label={panel.kind==='mention'?'Mention details':'Comment'} style={{left:Math.max(8,Math.min((panelRect[0]+28)*zoom,width-294)),top:(minimal?scroll:0)+Math.max(8,Math.min(panelRect[3]*zoom-scroll+8,290))}}><button className="close-panel" onClick={closePanel}>Close</button>{panel.kind==='mention'?<MentionDetails/>:<><strong>Comment</strong>{panel.atomId==='review'&&<p>Can we limit this to the core editing flow?</p>}<label>Reply<textarea value={(panelPlacement?.node.kind==='paragraph'||panelPlacement?.node.kind==='heading')?panelPlacement.node.comments.find(c=>c.id===panel.atomId)?.data.reply??'':''} onChange={e=>{const node=panelPlacement?.node;if((node?.kind==='paragraph'||node?.kind==='heading'))dispatch(tree.order.flatMap(({node:part})=>(part.kind==='paragraph'||part.kind==='heading')&&part.comments.some(c=>c.id===panel.atomId)?[{kind:'updateBlock',node:{...part,comments:part.comments.map(c=>c.id===panel.atomId?{...c,data:{...c.data,reply:e.target.value}}:c)}}]:[]));}}/></label></>}</div>,portal)}
      </div></div>
      <p className="input-notice" role="status">{inputNotice}</p>{!minimal&&<footer>Canvas text · React controls · Paragraph-local layout <span>{sample.total?`${nodes.length.toLocaleString()} / ${sample.total.toLocaleString()} blocks`:''}{!bookSamples.some(book=>book.id===sample.id)?` · ${visible.filter(p=>p.node.kind==='checklist').length} mounted checklists`:''}</span></footer>}
    </main>
  </CanvasLayerProvider></TeamContext.Provider>;
}
function DemoHost({kit,owned,initial}:{kit:CanvasKit;owned:Owned;initial:HybridSample}){
  const [sample,setSample]=useState<HybridSample|null>(initial);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const request=useRef(0);
  async function switchSample(url:URL,push:boolean){
    const id=++request.current;setLoading(true);setError('');
    try{
      const next=await loadHybridSample(url);if(id!==request.current)return;
      // Dispose old scene snapshots and streaming work before the new scene uses
      // the shared engine. Keep WASM, fonts, and imported sample data resident.
      flushSync(()=>setSample(null));
      if(push)history.pushState(null,'',url);
      window.scrollTo(0,0);
      setSample(next);
    }catch(error){if(id===request.current)setError(error instanceof Error?error.message:'Could not load sample');}
    finally{if(id===request.current)setLoading(false);}
  }
  useEffect(()=>{
    const back=()=>{void switchSample(new URL(location.href),false);};
    window.addEventListener('popstate',back);
    return()=>{request.current++;window.removeEventListener('popstate',back);};
  },[]);
  return <>{sample&&<App kit={kit} owned={owned} sample={sample} loading={loading} onSampleChange={id=>{void switchSample(new URL(sampleUrl(id)),true);}}/>}{error&&<p role="alert">{error}</p>}</>;
}
const root=document.getElementById('root');
if(!root)throw new Error('Missing root');
(async()=>{root.textContent='Loading sample…';const [kit,sample]=await Promise.all([CanvasKitInit({locateFile:()=>'/engines/canvaskit.wasm'}),loadHybridSample()]);const owned=await createOwnedEngine(kit,'shaping');createRoot(root).render(<DemoHost kit={kit} owned={owned} initial={sample}/>);})().catch(error=>{root.setAttribute('role','alert');root.textContent=String(error);});
