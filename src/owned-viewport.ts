import type {CanvasKit} from 'canvaskit-wasm';
import type {LaidOut} from './engines';
import {createOwnedEngine} from './owned-layout';
import type {OwnedBlock} from './owned-blocks';

export async function checkOwnedViewport(kit: CanvasKit) {
  const owned = await createOwnedEngine(kit, 'shaping');
  const source = Array.from({length:10000},(_,i) => {
    const text = `Paragraph ${i}: office café with some styled text and enough words to wrap onto multiple lines.`;
    const start = text.indexOf('office');
    return { text, spans: [{start,end:start+6,bold:true,italic:false},{start:start+7,end:start+12,bold:false,italic:true}] };
  });
  const created = kit.MakeSurface(500,640);
  if (!created) throw new Error('Viewport surface unavailable');
  const surface=created, canvas=surface.getCanvas();
  const checks: Record<string,boolean>={};
  const check=(name:string,ok:boolean)=>{checks[name]=(checks[name]??true)&&ok;};
  function draw(snapshot:LaidOut, scroll:number, culled:boolean, dpr=1) {
    canvas.clear(kit.WHITE); canvas.save(); canvas.scale(dpr,dpr);
    let submitted={paragraphs:10000,runs:0};
    if(culled) {
      if(!snapshot.drawViewport)throw new Error('Missing viewport renderer');
      // The translated document starts at y=4-scroll. Match the surface bounds.
      submitted=snapshot.drawViewport(canvas,4,4-scroll,scroll-4,scroll-4+640/dpr);
    } else snapshot.draw(canvas,4,4-scroll);
    canvas.restore();surface.flush();return submitted;
  }
  function pixels(snapshot:LaidOut,scroll:number,culled:boolean,dpr:number) {
    draw(snapshot,scroll,culled,dpr);
    const image=surface.makeImageSnapshot(), bytes=image.encodeToBytes();image.delete();
    if(!bytes)throw new Error('No pixels');return bytes;
  }
  const document=owned.createBlockDocument({width:480,size:20});
  const snapshot=document.splice(0,0,source);
  for(const dpr of [1,1.5,2]) for(const scroll of [-10,0,64,67.25,snapshot.height/2,snapshot.height-640,snapshot.height+100]) {
    const all=pixels(snapshot,scroll,false,dpr), visible=pixels(snapshot,scroll,true,dpr);
    check('pixels',all.length===visible.length&&all.every((byte,i)=>byte===visible[i]));
  }
  const overflowDoc=owned.createBlockDocument({width:160,size:72});
  const overhang=overflowDoc.splice(0,0,[
    {text:'first',spans:[]},{text:'a'+'\u0301'.repeat(25),spans:[]},{text:'last',spans:[]},
  ]);
  for(const scroll of [0,80,115,160,230]) {
    const a=pixels(overhang,scroll,false,1),b=pixels(overhang,scroll,true,1);
    check('overflowPixels',a.length===b.length&&a.every((byte,i)=>byte===b[i]));
  }
  overflowDoc.release();
  const baseline={...owned.stats};
  const samples=[];
  for(const scroll of [0,snapshot.height/2,snapshot.height-640]) {
    const values:number[][]=[[],[]];let submitted={paragraphs:0,runs:0};
    for(let trial=-5;trial<30;trial++) {
      for(const i of trial%2?[1,0]:[0,1]) {
        const start=performance.now();const counts=draw(snapshot,scroll,i===1);
        const elapsed=performance.now()-start;
        if(trial>=0)values[i].push(elapsed);
        if(i===1)submitted=counts;
      }
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    check('boundedSubmissions',submitted.paragraphs>0&&submitted.paragraphs<30);
    samples.push({scroll,submitted,all:values[0],culled:values[1]});
  }
  check('drawDoesNotLayout',JSON.stringify(baseline)===JSON.stringify(owned.stats));
  document.release();
  check('snapshotAfterRelease',draw(snapshot,0,true).paragraphs>0);

  const serialized=source.map(block=>JSON.stringify(block));
  const loading=[];
  for(let trial=0;trial<3;trial++)for(const adaptive of trial%2?[true,false]:[false,true]) {
    const doc=owned.createBlockDocument({width:480,size:20});
    const samples=[];let cursor=0,batch=adaptive?16:500;
    const started=performance.now();
    while(cursor<serialized.length) {
      const count=Math.min(batch,serialized.length-cursor), start=performance.now();
      // Generated fixture input; encoding happened before timing. Parsing is timed.
      const blocks:OwnedBlock[]=JSON.parse('['+serialized.slice(cursor,cursor+count).join(',')+']');
      const before={...owned.stats};
      const result=doc.splice(cursor,0,blocks);
      const drawn=draw(result,0,true);
      const duration=performance.now()-start;
      check('appendOnlyValidatesNew',owned.stats.validatedBlocks-before.validatedBlocks===count);
      check('appendOnlyComposesNew',owned.stats.compositions-before.compositions===count);
      cursor+=count;
      samples.push({count,loaded:cursor,workMs:duration,elapsedMs:performance.now()-started,drawn:drawn.paragraphs});
      // Bounded feedback, not a hard real-time guarantee: one update cannot be
      // preempted, and GC plus placement rebuilding can exceed the target.
      if(adaptive)batch=Math.max(1,Math.min(256,Math.floor(count*Math.min(2,Math.max(.5,8/Math.max(duration,.1))))));
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    const final=doc.snapshot();
    check('streamFinalLines',JSON.stringify(final.lines)===JSON.stringify(snapshot.lines));
    for(const scroll of [0,snapshot.height/2,snapshot.height-640]){
      const a=pixels(final,scroll,true,1),b=pixels(snapshot,scroll,false,1);
      check('streamFinalPixels',a.length===b.length&&a.every((byte,i)=>byte===b[i]));
    }
    loading.push({trial,adaptive,samples});doc.release();
  }
  surface.dispose();
  return {paragraphs:10000,pixelCases:26,drawSamples:samples,loading,checks,retention:owned.retention()};
}
