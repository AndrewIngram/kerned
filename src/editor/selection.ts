import type {NodeIdentity,Schema} from './schema';
import {indexTree,type TreeIndex} from './tree';
import {validateTextRange} from './text';
import type {Step} from './transactions';
import {mapPosition,type PositionMap} from './positions';

export type TextPoint={id:number;offset:number};
export type SelectionRange={kind:'text';id:number;from:number;to:number}|{kind:'node';id:number};
export type SelectionContext={
  node(id:number):NodeIdentity|undefined;
  byKey(key:string):NodeIdentity|undefined;
  text(id:number):string|null;
  selectable(id:number):boolean;
  children(parent:number|null):readonly NodeIdentity[];
  location(id:number):{parent:number|null;index:number}|undefined;
  order():readonly NodeIdentity[];
};
export function selectionContext<N extends NodeIdentity>(schema:Schema<N>,nodes:N[],tree:TreeIndex<N>=indexTree(schema,nodes)):SelectionContext{
  return {
    node:id=>tree.byId.get(id)?.node,byKey:key=>tree.byKey.get(key)?.node,
    text(id){const node=tree.byId.get(id)?.node;return node?schema.text(node):null;},
    selectable(id){const node=tree.byId.get(id)?.node;return !!node&&schema.resolve(node).selectable!==false;},
    children(parent){if(parent===null)return nodes;const node=tree.byId.get(parent)?.node;return node?schema.children(node):[];},
    location(id){const entry=tree.byId.get(id);return entry?{parent:entry.parent,index:entry.index}:undefined;},
    order:()=>tree.order.map(entry=>entry.node),
  };
}
export type SelectionMapping={point(point:TextPoint):TextPoint;node(id:number):number|null;near(id:number):TextPoint|null};
export function selectionMapping(before:SelectionContext,after:SelectionContext,maps:readonly PositionMap[]):SelectionMapping{
  return {
    point(point){let next={id:point.id,index:point.offset};for(const map of maps)next=mapPosition(next.id,next.index,1,map);return {id:next.id,offset:next.index};},
    node:id=>after.node(id)?id:null,
    near(id){
      const order=before.order(),at=order.findIndex(node=>node.id===id);
      for(let i=at+1;i<order.length;i++)if(after.text(order[i].id)!==null)return {id:order[i].id,offset:0};
      for(let i=at-1;i>=0;i--){const text=after.text(order[i].id);if(text!==null)return {id:order[i].id,offset:text.length};}
      const node=after.order().find(node=>after.text(node.id)!==null);return node?{id:node.id,offset:0}:null;
    },
  };
}
export type SelectionBookmark={map(mapping:SelectionMapping):SelectionBookmark;resolve(context:SelectionContext):Selection};
export type SelectionStep=Extract<Step<NodeIdentity>,{kind:'replaceText'|'replaceRanges'|'join'|'removeChildren'}>;
export type SelectionEdit={steps:SelectionStep[];selection?:Selection};
export type SelectionFragment={kind:'text';node:NodeIdentity;from:number;to:number;text:string}|{kind:'node';node:NodeIdentity};
export type SelectionContent={type:string;fragments:readonly SelectionFragment[]};
export type SelectionJSON={type:string;version:1;data:unknown};
export type SelectionExtension={type:string;read(context:SelectionContext,data:unknown):Selection};

/** Runtime protocol. Codecs are only used when crossing a persistence boundary. */
export abstract class Selection{
  abstract readonly type:string;
  abstract eq(other:Selection):boolean;
  abstract validate(context:SelectionContext):void;
  abstract ranges(context:SelectionContext):readonly SelectionRange[];
  isEmpty(context:SelectionContext):boolean{return this.ranges(context).every(range=>range.kind==='text'&&range.from===range.to);}
  content(context:SelectionContext):SelectionContent{
    const fragments:SelectionFragment[]=this.ranges(context).map(range=>{
      const node=context.node(range.id);if(!node)throw new Error('Missing selected content');
      return range.kind==='node'?{kind:'node',node}:{kind:'text',node,from:range.from,to:range.to,text:(context.text(range.id)??'').slice(range.from,range.to)};
    });return {type:this.type,fragments};
  }
  abstract getBookmark():SelectionBookmark;
  abstract encode(context:SelectionContext):SelectionJSON;
  abstract replace(context:SelectionContext,text:string):SelectionEdit;
  map(context:SelectionContext,mapping:SelectionMapping):Selection{return this.getBookmark().map(mapping).resolve(context);}
}
function validPoint(context:SelectionContext,point:TextPoint){const text=context.text(point.id);if(text===null)throw new Error('Selection requires a text endpoint');validateTextRange(text,point.offset,point.offset);}
export function selectionNear(context:SelectionContext,point?:TextPoint|null):Selection{
  if(point&&context.text(point.id)!==null){const text=context.text(point.id)??'';if(point.offset>=0&&point.offset<=text.length){try{validPoint(context,point);return new TextSelection(point,point);}catch{ /* A removed grapheme boundary needs a valid cursor. */ }}return textSelection(point.id,0);}
  for(const node of context.order()){if(context.text(node.id)!==null)return textSelection(node.id,0);if(context.selectable(node.id))return new NodeSelection(node.id);}
  return new AllSelection();
}
export class TextSelection extends Selection{
  readonly type='text';
  constructor(readonly anchor:TextPoint,readonly head:TextPoint=anchor,readonly upstream=false){super();}
  override isEmpty(_context:SelectionContext){return this.anchor.id===this.head.id&&this.anchor.offset===this.head.offset;}
  eq(other:Selection){return other instanceof TextSelection&&this.anchor.id===other.anchor.id&&this.anchor.offset===other.anchor.offset&&this.head.id===other.head.id&&this.head.offset===other.head.offset&&this.upstream===other.upstream;}
  validate(context:SelectionContext){validPoint(context,this.anchor);validPoint(context,this.head);}
  ranges(context:SelectionContext):SelectionRange[]{
    this.validate(context);
    if(this.anchor.id===this.head.id)return [{kind:'text',id:this.anchor.id,from:Math.min(this.anchor.offset,this.head.offset),to:Math.max(this.anchor.offset,this.head.offset)}];
    const order=context.order(),a=order.findIndex(node=>node.id===this.anchor.id),h=order.findIndex(node=>node.id===this.head.id),start=a<h?this.anchor:this.head,end=a<h?this.head:this.anchor;
    const result:SelectionRange[]=[];
    for(const node of order.slice(Math.min(a,h),Math.max(a,h)+1)){
      const text=context.text(node.id);if(text!==null)result.push({kind:'text',id:node.id,from:node.id===start.id?start.offset:0,to:node.id===end.id?end.offset:text.length});
      else if(context.children(node.id).length===0)result.push({kind:'node',id:node.id});
    }
    return result;
  }
  getBookmark():SelectionBookmark{return new TextBookmark(this.anchor,this.head,this.upstream);}
  encode(context:SelectionContext):SelectionJSON{return {type:this.type,version:1,data:{anchor:writePoint(context,this.anchor),head:writePoint(context,this.head),upstream:this.upstream}};}
  replace(context:SelectionContext,text:string):SelectionEdit{
    const ranges=this.ranges(context),first=ranges[0];if(!first||first.kind!=='text')throw new Error('Missing text selection range');
    // Join sibling text blocks. Crossing container boundaries needs an extension command.
    const textRanges=ranges.filter(range=>range.kind==='text');
    if(textRanges.length>1){
      const location=context.location(first.id);
      if(!location||textRanges.some(range=>context.location(range.id)?.parent!==location.parent))throw new Error('Cross-container replacement requires a structural extension command');
    }
    return {steps:[{kind:'replaceRanges',ranges,text,pruneEmpty:[]}],selection:textSelection(first.id,first.from+text.length)};
  }
}
class TextBookmark implements SelectionBookmark{
  constructor(readonly anchor:TextPoint,readonly head:TextPoint,readonly upstream:boolean){}
  map(mapping:SelectionMapping):SelectionBookmark{
    const a=mapping.point(this.anchor),h=mapping.point(this.head),anchor=mapping.node(a.id)===null?mapping.near(a.id):a,head=mapping.node(h.id)===null?mapping.near(h.id):h;
    return anchor&&head?new TextBookmark(anchor,head,this.upstream):new NearbyBookmark();
  }
  resolve(context:SelectionContext):Selection{const selection=new TextSelection(this.anchor,this.head,this.upstream);try{selection.validate(context);return selection;}catch{return selectionNear(context,this.head);}}
}
export function textSelection(id:number,anchor:number,head=anchor,upstream=false){return new TextSelection({id,offset:anchor},{id,offset:head},upstream);}
export class NodeSelection extends Selection{
  readonly type='node';
  constructor(readonly id:number){super();}
  eq(other:Selection){return other instanceof NodeSelection&&other.id===this.id;}
  validate(context:SelectionContext){if(!context.node(this.id)||!context.selectable(this.id))throw new Error('Node is not selectable');}
  ranges(context:SelectionContext):SelectionRange[]{this.validate(context);return [{kind:'node',id:this.id}];}
  getBookmark():SelectionBookmark{return new NodeBookmark(this.id);}
  encode(context:SelectionContext):SelectionJSON{this.validate(context);return {type:this.type,version:1,data:{key:context.node(this.id)?.key}};}
  replace(context:SelectionContext,text:string):SelectionEdit{this.validate(context);if(text)throw new Error('Replacing a node with text requires a schema insertion command');const location=context.location(this.id);if(!location)throw new Error('Missing selected node');return {steps:[{kind:'removeChildren',...location,count:1}]};}
}
class NodeBookmark implements SelectionBookmark{
  constructor(readonly id:number){}
  map(mapping:SelectionMapping):SelectionBookmark{const id=mapping.node(this.id);if(id!==null)return new NodeBookmark(id);const near=mapping.near(this.id);return near?new TextBookmark(near,near,false):new NearbyBookmark();}
  resolve(context:SelectionContext):Selection{return context.node(this.id)&&context.selectable(this.id)?new NodeSelection(this.id):selectionNear(context);}
}
export class AllSelection extends Selection{
  readonly type='all';
  eq(other:Selection){return other instanceof AllSelection;}
  validate(_context:SelectionContext){}
  ranges(context:SelectionContext):SelectionRange[]{return context.children(null).map(node=>({kind:'node',id:node.id}));}
  getBookmark():SelectionBookmark{return new AllBookmark();}
  encode(_context:SelectionContext):SelectionJSON{return {type:this.type,version:1,data:null};}
  replace(context:SelectionContext,text:string):SelectionEdit{if(text)throw new Error('Replacing the document with text requires a schema insertion command');return {steps:[{kind:'removeChildren',parent:null,index:0,count:context.children(null).length}],selection:new AllSelection()};}
}
class NearbyBookmark implements SelectionBookmark{map(_mapping:SelectionMapping){return this;}resolve(context:SelectionContext){return selectionNear(context);}}
class AllBookmark implements SelectionBookmark{map(_mapping:SelectionMapping){return this;}resolve(_context:SelectionContext){return new AllSelection();}}
function record(value:unknown):Record<string,unknown>{if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Invalid selection data');return Object.fromEntries(Object.entries(value));}
function writePoint(context:SelectionContext,point:TextPoint){validPoint(context,point);return {key:context.node(point.id)?.key,offset:point.offset};}
function readPoint(context:SelectionContext,value:unknown):TextPoint{const data=record(value);if(typeof data.key!=='string'||typeof data.offset!=='number'||!Number.isSafeInteger(data.offset))throw new Error('Invalid selection point');const node=context.byKey(data.key);if(!node)throw new Error('Missing selection key');const point={id:node.id,offset:data.offset};validPoint(context,point);return point;}
export function createSelectionRegistry(extensions:readonly SelectionExtension[]=[]){
  const registered=new Map<string,SelectionExtension>();
  const builtins:SelectionExtension[]=[
    {type:'text',read(context,value){const data=record(value);if(typeof data.upstream!=='boolean')throw new Error('Invalid selection affinity');return new TextSelection(readPoint(context,data.anchor),readPoint(context,data.head),data.upstream);}},
    {type:'node',read(context,value){const data=record(value);if(typeof data.key!=='string')throw new Error('Invalid node key');const node=context.byKey(data.key);if(!node)throw new Error('Missing node key');return new NodeSelection(node.id);}},
    {type:'all',read(_context,value){if(value!==null)throw new Error('Invalid all selection');return new AllSelection();}},
  ];
  for(const extension of [...builtins,...extensions]){if(!extension.type||registered.has(extension.type))throw new Error('Duplicate or empty selection type');registered.set(extension.type,extension);}
  return {
    validate(context:SelectionContext,selection:Selection){if(!registered.has(selection.type))throw new Error(`Unregistered selection: ${selection.type}`);selection.validate(context);},
    read(context:SelectionContext,value:unknown){const data=record(value);if(data.version!==1||typeof data.type!=='string')throw new Error('Invalid selection envelope');const extension=registered.get(data.type);if(!extension)throw new Error('Unknown selection type');const selection=extension.read(context,data.data);if(selection.type!==extension.type)throw new Error('Selection codec changed type');selection.validate(context);return selection;},
  };
}
