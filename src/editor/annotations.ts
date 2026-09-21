export type RangeAnnotation<Data> = {id:string;start:number;end:number;data:Data};

export type AnnotationPolicy = {startBias:-1|1;endBias:-1|1;onOverlap:'remove'|'map'};

/** Policy belongs to the extension: comments and search results need not agree. */
export function replaceAnnotations<Data>(ranges:readonly RangeAnnotation<Data>[],from:number,to:number,inserted:number,policy:AnnotationPolicy):RangeAnnotation<Data>[] {
  const delta=inserted-(to-from);

  function position(index:number,bias:-1|1){return index<from?index:index>to?index+delta:from+(bias===1?inserted:0);}

  return ranges.flatMap(range=>{
    if(from===to){return [{...range,start:range.start===from?position(range.start,policy.startBias):range.start>from?range.start+delta:range.start,end:range.end===from?position(range.end,policy.endBias):range.end>from?range.end+delta:range.end}];}

    if(to<=range.start)return [{...range,start:range.start+delta,end:range.end+delta}];

    if(from>=range.end)return [range];

    if(policy.onOverlap==='remove')return [];
    const start=position(range.start,policy.startBias),end=position(range.end,policy.endBias);

    return start<end?[{...range,start,end}]:[];
  });
}

export function sliceAnnotations<Data>(ranges:readonly RangeAnnotation<Data>[],from:number,to:number):RangeAnnotation<Data>[] {
  return ranges.flatMap(range=>range.end>from&&range.start<to?[{...range,start:Math.max(range.start,from)-from,end:Math.min(range.end,to)-from}]:[]);
}

export function joinAnnotations<Data>(left:readonly RangeAnnotation<Data>[],right:readonly RangeAnnotation<Data>[],offset:number,sameData:(a:Data,b:Data)=>boolean):RangeAnnotation<Data>[] {
  const result=[...left];

  for(const range of right){
    const shifted={...range,start:range.start+offset,end:range.end+offset};
    const same=result.findIndex(value=>value.id===range.id&&value.end===shifted.start&&sameData(value.data,range.data));

    if(same>=0)result[same]={...result[same],end:shifted.end};else result.push(shifted);
  }

  return result;
}
