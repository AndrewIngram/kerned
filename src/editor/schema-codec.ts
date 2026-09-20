import type {NodeIdentity,Schema} from './schema';
import {validateTree} from './tree';
export type JsonValue = null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type NodeCodec<N extends NodeIdentity>={
  encode(node:N):JsonValue;
  decode(data:unknown,context:{identity:NodeIdentity;children:N[]}):N;
};
export function jsonRecord(value:unknown):Record<string,unknown>{
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('Expected an object');
  return value as Record<string,unknown>;
}
export function jsonString(value:unknown):string{if(typeof value!=='string')throw new Error('Expected a string');return value;}
export function jsonNumber(value:unknown):number{if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Expected a finite number');return value;}
export function jsonBoolean(value:unknown):boolean{if(typeof value!=='boolean')throw new Error('Expected a boolean');return value;}
export function jsonArray(value:unknown):unknown[]{if(!Array.isArray(value))throw new Error('Expected an array');return value;}
/** Copy JSON values at persistence boundaries; reject lossy values and cycles. */
export function jsonValue(value:unknown,depth=0):JsonValue{
  if(depth>256)throw new Error('JSON exceeds nesting limit');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number')return jsonNumber(value);
  if(Array.isArray(value))return value.map(item=>jsonValue(item,depth+1));
  const record=jsonRecord(value);
  if(Object.getPrototypeOf(record)!==Object.prototype&&Object.getPrototypeOf(record)!==null)throw new Error('Expected plain JSON data');
  return Object.fromEntries(Object.entries(record).map(([name,item])=>[name,jsonValue(item,depth+1)]));
}
/** Versioned document data only. Session history, references and feature stores persist separately. */
export function createDocumentCodec<N extends NodeIdentity>(schema:Schema<N>){
  const byName=new Map(schema.extensions.map(extension=>[extension.name,extension]));
  function decode(value:unknown):N[]{
    const document=jsonRecord(value);
    if(document.version!==1)throw new Error('Unsupported document format');
    let count=0;
    function node(value:unknown,depth:number):N{
      if(depth>256||++count>1_000_000)throw new Error('Document exceeds decode limits');
      const data=jsonRecord(value),type=jsonString(data.type),extension=byName.get(type);
      if(!extension?.codec)throw new Error(`Missing node codec: ${type}`);
      if(data.version!==extension.version)throw new Error(`Unsupported ${type} version`);
      const id=jsonNumber(data.id),key=jsonString(data.key);
      if(!Number.isSafeInteger(id)||!key)throw new Error('Invalid node identity');
      const identity:NodeIdentity={id,key,...(data.locked===undefined?{}:{locked:jsonBoolean(data.locked)})};
      const children=jsonArray(data.children).map(child=>node(child,depth+1));
      if(extension.kind!=='container'&&children.length)throw new Error('Non-container has children');
      const result=extension.codec.decode(data.data,{identity,children});
      if(schema.resolve(result)!==extension||result.id!==id||result.key!==key||result.locked!==identity.locked)throw new Error('Codec changed node identity or type');
      const actual=schema.children(result);
      if(actual.length!==children.length||actual.some((child,i)=>child!==children[i]))throw new Error('Codec changed child content');
      return result;
    }
    const nodes=jsonArray(document.nodes).map(value=>node(value,0));validateTree(schema,nodes);return nodes;
  }
  function encode(nodes:readonly N[]):JsonValue{
    validateTree(schema,nodes);
    function node(value:N,depth:number):JsonValue{
      if(depth>256)throw new Error('Document exceeds encode depth');
      const extension=schema.resolve(value);if(!extension.codec)throw new Error(`Missing node codec: ${extension.name}`);
      return {type:extension.name,version:extension.version,id:value.id,key:value.key,...(value.locked===undefined?{}:{locked:value.locked}),data:jsonValue(extension.codec.encode(value)),children:schema.children(value).map(child=>node(child,depth+1))};
    }
    return {version:1,nodes:nodes.map(value=>node(value,0))};
  }
  return {encode,decode};
}
