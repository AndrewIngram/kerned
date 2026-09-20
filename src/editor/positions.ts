export type PositionMap =
  | {kind:'children';parent:number|null;index:number;removed:number;inserted:number}
  | {kind:'unwrap';id:number;parent:number|null;index:number;count:number}
  | {kind:'wrap';id:number;parent:number|null;index:number;count:number}
  | {kind:'replace';id:number;from:number;to:number;inserted:number}
  | {kind:'split';id:number;at:number;rightId:number}
  | {kind:'join';left:number;right:number;at:number};

export function mapPosition(id:number,index:number,bias:-1|1,map:PositionMap){
  switch(map.kind){
    case 'children':case 'unwrap':case 'wrap':return {id,index};
    case 'replace':
      if(id!==map.id)return {id,index};
      if(index<map.from)return {id,index};
      if(index>map.to)return {id,index:index+map.inserted-(map.to-map.from)};
      return {id,index:map.from+(bias===1?map.inserted:0)};
    case 'split':return id===map.id&&(index>map.at||index===map.at&&bias===1)?{id:map.rightId,index:index-map.at}:{id,index};
    case 'join':return id===map.right?{id:map.left,index:map.at+index}:{id,index};
  }
}

export function invertPositionMap(map:PositionMap):PositionMap{
  switch(map.kind){
    case 'children':return {...map,removed:map.inserted,inserted:map.removed};
    case 'wrap':return {...map,kind:'unwrap'};
    case 'unwrap':return {...map,kind:'wrap'};
    case 'replace':return {...map,to:map.from+map.inserted,inserted:map.to-map.from};
    case 'split':return {kind:'join',left:map.id,right:map.rightId,at:map.at};
    case 'join':return {kind:'split',id:map.left,rightId:map.right,at:map.at};
  }
}
