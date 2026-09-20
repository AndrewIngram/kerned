import {Selection,textSelection,selectionNear,type SelectionContext,type SelectionMapping,type SelectionBookmark,type SelectionRange,type SelectionJSON,type SelectionExtension,type SelectionEdit,type SelectionStep} from '../editor';

export type GridCell={id:number;colspan:number;rowspan:number};
/** The schema extension projects its own table representation into logical rows. */
export type TableSelectionAdapter={rows(context:SelectionContext,tableId:number):readonly (readonly GridCell[])[]|null};
type Rect={left:number;top:number;right:number;bottom:number};
export function createCellSelectionExtension(adapter:TableSelectionAdapter){
  const cache=new WeakMap<object,ReturnType<typeof buildGrid>>();
  function buildGrid(rows:readonly (readonly GridCell[])[]){
    const width=rows[0]?.reduce((sum,cell)=>sum+cell.colspan,0)??0,height=rows.length;
    if(!width||!height||!Number.isSafeInteger(width))throw new Error('Empty or invalid table');
    const slots=new Int32Array(width*height).fill(-1),cells:GridCell[]=[],bounds=new Map<number,Rect>();
    for(let y=0;y<height;y++){
      let x=0;
      for(const cell of rows[y]){
        if(bounds.has(cell.id)||!Number.isSafeInteger(cell.colspan)||!Number.isSafeInteger(cell.rowspan)||cell.colspan<1||cell.rowspan<1)throw new Error('Invalid cell spans or duplicate cell');
        while(x<width&&slots[y*width+x]!==-1)x++;
        if(x+cell.colspan>width||y+cell.rowspan>height)throw new Error('Cell extends beyond table');
        const index=cells.length;cells.push(cell);bounds.set(cell.id,{left:x,top:y,right:x+cell.colspan,bottom:y+cell.rowspan});
        for(let row=y;row<y+cell.rowspan;row++)for(let col=x;col<x+cell.colspan;col++){const slot=row*width+col;if(slots[slot]!==-1)throw new Error('Overlapping table cells');slots[slot]=index;}
        x+=cell.colspan;
      }
    }
    if(slots.some(index=>index===-1))throw new Error('Missing table cells');
    return {width,height,slots,cells,bounds};
  }
  function grid(context:SelectionContext,tableId:number){
    const node=context.node(tableId);if(!node)throw new Error('Missing table');
    const cached=cache.get(node);if(cached)return cached;
    const rows=adapter.rows(context,tableId);if(!rows)throw new Error('Not a table');
    const result=buildGrid(rows);for(const cell of result.cells)if(!context.node(cell.id))throw new Error('Missing grid cell');cache.set(node,result);return result;
  }
  function rectangle(context:SelectionContext,selection:CellSelection){
    const map=grid(context,selection.tableId),anchor=map.bounds.get(selection.anchorCell),head=map.bounds.get(selection.headCell);
    if(!anchor||!head)throw new Error('Selection cells must belong to the same table');
    const rect={left:Math.min(anchor.left,head.left),top:Math.min(anchor.top,head.top),right:Math.max(anchor.right,head.right),bottom:Math.max(anchor.bottom,head.bottom)};
    return {map,rect};
  }
  class CellSelection extends Selection{
    readonly type='cell';
    override isEmpty(_context:SelectionContext){return false;}
    constructor(readonly tableId:number,readonly anchorCell:number,readonly headCell=anchorCell,readonly extent:'rectangle'|'row'|'column'='rectangle'){super();}
    eq(other:Selection){return other instanceof CellSelection&&this.tableId===other.tableId&&this.anchorCell===other.anchorCell&&this.headCell===other.headCell&&this.extent===other.extent;}
    validate(context:SelectionContext){rectangle(context,this);}
    cells(context:SelectionContext){
      const {map,rect}=rectangle(context,this);
      if(this.extent==='row'){rect.left=0;rect.right=map.width;}if(this.extent==='column'){rect.top=0;rect.bottom=map.height;}
      const ids=new Set<number>();
      for(let y=rect.top;y<rect.bottom;y++)for(let x=rect.left;x<rect.right;x++){
        const cell=map.cells[map.slots[y*map.width+x]],bounds=map.bounds.get(cell.id);
        // Like ProseMirror, count each cell whose top-left lies in the rectangle once.
        if(bounds&&bounds.left>=rect.left&&bounds.top>=rect.top)ids.add(cell.id);
      }
      return [this.headCell,...[...ids].filter(id=>id!==this.headCell)];
    }
    ranges(context:SelectionContext):SelectionRange[]{
      const ranges:SelectionRange[]=[];
      function visit(id:number){const text=context.text(id);if(text!==null)ranges.push({kind:'text',id,from:0,to:text.length});else {const children=context.children(id);if(children.length)children.forEach(node=>visit(node.id));else ranges.push({kind:'node',id});}}
      for(const id of this.cells(context))context.children(id).forEach(node=>visit(node.id));return ranges;
    }
    getBookmark():SelectionBookmark{return new CellBookmark(this.tableId,this.anchorCell,this.headCell,this.extent);}
    encode(context:SelectionContext):SelectionJSON{this.validate(context);return {type:this.type,version:1,data:{table:context.node(this.tableId)?.key,anchor:context.node(this.anchorCell)?.key,head:context.node(this.headCell)?.key,extent:this.extent}};}
    replace(context:SelectionContext,text:string):SelectionEdit{
      const ranges=this.ranges(context),steps:SelectionStep[]=[],primary=ranges.find(range=>range.kind==='text');
      if(text&&!primary)throw new Error('Cell text insertion requires a text block');
      // Reverse tree order keeps removal indexes valid, independently of primary range order.
      const order=context.order(),rank=new Map(order.map((node,i)=>[node.id,i]));
      for(const range of [...ranges].sort((a,b)=>(rank.get(b.id)??0)-(rank.get(a.id)??0))){
        if(range.kind==='text')steps.push({kind:'replaceText',id:range.id,from:range.from,to:range.to,text:range===primary?text:''});
        else {const location=context.location(range.id);if(location)steps.push({kind:'removeChildren',...location,count:1});}
      }
      return {steps,selection:primary?textSelection(primary.id,text.length):undefined};
    }
  }
  class CellBookmark implements SelectionBookmark{
    constructor(readonly tableId:number,readonly anchor:number,readonly head:number,readonly extent:'rectangle'|'row'|'column'){}
    map(mapping:SelectionMapping):SelectionBookmark{
      if(mapping.node(this.tableId)!==null&&mapping.node(this.anchor)!==null&&mapping.node(this.head)!==null)return this;
      const point=mapping.near(this.head);return point?textSelection(point.id,point.offset).getBookmark():{map(){return this;},resolve:context=>selectionNear(context)};
    }
    resolve(context:SelectionContext):Selection{const selection=new CellSelection(this.tableId,this.anchor,this.head,this.extent);try{selection.validate(context);return selection;}catch{return selectionNear(context);}}
  }
  const extension:SelectionExtension={type:'cell',read(context,value){
    if(typeof value!=='object'||value===null||!('table'in value)||!('anchor'in value)||!('head'in value)||!('extent'in value)||typeof value.table!=='string'||typeof value.anchor!=='string'||typeof value.head!=='string'||(value.extent!=='rectangle'&&value.extent!=='row'&&value.extent!=='column'))throw new Error('Invalid cell selection');
    const table=context.byKey(value.table),anchor=context.byKey(value.anchor),head=context.byKey(value.head);if(!table||!anchor||!head)throw new Error('Missing cell selection keys');return new CellSelection(table.id,anchor.id,head.id,value.extent);
  }};
  return {CellSelection,extension,grid};
}
