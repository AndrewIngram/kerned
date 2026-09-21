import type {TableNode} from './demo-model';

/** Plain-text clipboard representation for a read-only table block. */
export function tablePlainText(table:TableNode):string{
  const rows=table.rows.map(row=>row.map(cell=>cell.paragraphs.map(p=>p.text).join('\n')).join('\t'));
  return (table.caption?[table.caption,...rows]:rows).join('\n');
}

import {createCellSelectionExtension} from './cell-selection';
import type {StarterNode,TextBlockNode,TableCell} from './demo-model';
import type {NodeExtension,NodeIdentity} from '../editor';
export const tableCells=createCellSelectionExtension({rows(context,id){
 const node=context.node(id);
 if(!node||!('kind'in node)||node.kind!=='table')return null;
 // The adapter only reads cells registered in the same schema tree.
 return context.children(id).reduce<{id:number;colspan:number;rowspan:number}[][]>((rows,cell)=>{
  if('row'in cell&&typeof cell.row==='number'&&'colspan'in cell&&typeof cell.colspan==='number'&&'rowspan'in cell&&typeof cell.rowspan==='number'){
   (rows[cell.row]??=[]).push({id:cell.id,colspan:cell.colspan,rowspan:cell.rowspan});
  }
  return rows;
 },[]);
}});
export const editableTableExtension:NodeExtension<StarterNode>={
 name:'table',version:1,kind:'container',accepts:node=>node.kind==='table',validateUpdate(){},
 content:{children:node=>node.kind==='table'?node.rows.flat():[],withChildren(node,children){
  if(node.kind!=='table')throw new Error('Expected table');
  const rows:TableCell[][]=[];for(const child of children){if(child.kind!=='tableCell')throw new Error('Expected cell');(rows[child.row]??=[]).push(child);}
  return {...node,rows};
 },validateChildren(node,children){if(node.kind!=='table'||!children.length||children.some(c=>c.kind!=='tableCell'))throw new Error('Tables require cells');}},
};
export const tableCellExtension:NodeExtension<StarterNode>={
 name:'tableCell',version:1,kind:'container',accepts:node=>node.kind==='tableCell',validateUpdate(){},
 content:{children:node=>node.kind==='tableCell'?node.paragraphs:[],withChildren(node,children){
  if(node.kind!=='tableCell')throw new Error('Expected cell');
  const paragraphs:TextBlockNode[]=[];for(const child of children){if((child.kind!=='paragraph'&&child.kind!=='heading'))throw new Error('Cells require paragraphs');paragraphs.push(child);}
  return {...node,paragraphs};
 },validateChildren(node,children,context){if(context.parent?.kind!=='table'||node.kind!=='tableCell'||!children.length||children.some(c=>(c.kind!=='paragraph'&&c.kind!=='heading')))throw new Error('Invalid table cell');}},
};
export function createTable(allocate:()=>NodeIdentity,rows=3,columns=3):TableNode{
 return {kind:'table',...allocate(),caption:'',rows:Array.from({length:rows},(_,row)=>Array.from({length:columns},()=>({kind:'tableCell',...allocate(),row,header:row===0,colspan:1,rowspan:1,paragraphs:[{kind:'paragraph',...allocate(),text:'',marks:[],inline:[]}]})))};
}

export function appendTableRow(table:TableNode,allocate:()=>NodeIdentity):TableNode{
 if(table.rows.some(row=>row.some(cell=>cell.colspan!==1||cell.rowspan!==1)))throw new Error('Row insertion is currently limited to tables without merged cells');
 const row=table.rows.length,columns=table.rows[0]?.length??1;
 const cells=createTable(allocate,1,columns).rows[0].map(cell=>({...cell,row,header:false}));
 return {...table,rows:[...table.rows,cells]};
}
export function appendTableColumn(table:TableNode,allocate:()=>NodeIdentity):TableNode{
 if(table.rows.some(row=>row.some(cell=>cell.colspan!==1||cell.rowspan!==1)))throw new Error('Column insertion is currently limited to tables without merged cells');
 const cells=createTable(allocate,table.rows.length,1).rows;
 return {...table,rows:table.rows.map((row,index)=>[...row,{...cells[index][0],header:row.every(cell=>cell.header)}])};
}
