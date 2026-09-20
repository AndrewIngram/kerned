import {boundaries} from './text';
export type InlineObject<Data> = {id:string;index:number;data:Data};
export type InlineExtension<Data,Layout> = {name:string;plainText(data:Data):string;layout(object:InlineObject<Data>):Layout};
export function replaceInlineObjects<Data>(objects:readonly InlineObject<Data>[],from:number,to:number,inserted:number):InlineObject<Data>[] {
  const delta=inserted-(to-from);
  return objects.filter(value=>value.index<from||value.index>=to).map(value=>value.index>=to?{...value,index:value.index+delta}:value);
}
export function sliceInlineObjects<Data>(objects:readonly InlineObject<Data>[],from:number,to:number):InlineObject<Data>[] {
  return objects.filter(value=>value.index>=from&&value.index<to).map(value=>({...value,index:value.index-from}));
}
export function validateInlineObjects<Data>(text:string,objects:readonly InlineObject<Data>[]){
  const stops=new Set(boundaries(text)),ids=new Set<string>(),indices=new Set<number>();
  for(const value of objects){
    if(ids.has(value.id)||indices.has(value.index)||text[value.index]!=='\ufffc')throw new Error('Invalid inline object identity or position');
    if(!stops.has(value.index)||!stops.has(value.index+1))throw new Error('Combining marks need a text character before them.');
    ids.add(value.id);indices.add(value.index);
  }
  for(let i=0;i<text.length;i++)if(text[i]==='\ufffc'&&!indices.has(i))throw new Error('Missing inline object');
}
export function inlinePlainText<Data>(text:string,objects:readonly InlineObject<Data>[],from:number,to:number,plainText:(data:Data)=>string){
  const labels=new Map(objects.map(value=>[value.index,plainText(value.data)]));
  let result='';for(let i=from;i<to;i++)result+=labels.get(i)??text[i];return result;
}
