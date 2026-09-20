import {replaceAnnotations,sliceAnnotations,joinAnnotations,type RangeAnnotation} from '../editor';
export type Comment = RangeAnnotation<{reply:string}>;
export const comment={
  name:'comment',
  replace:(ranges:Comment[],from:number,to:number,inserted:number)=>replaceAnnotations(ranges,from,to,inserted,{startBias:1,endBias:-1,onOverlap:'remove'}),
  slice:(ranges:Comment[],from:number,to:number)=>sliceAnnotations(ranges,from,to),
  join:(left:Comment[],right:Comment[],offset:number)=>joinAnnotations(left,right,offset,(a,b)=>a.reply===b.reply),
};
