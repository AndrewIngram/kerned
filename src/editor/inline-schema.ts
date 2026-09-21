import {jsonRecord,jsonString,jsonNumber,jsonArray,jsonValue,type JsonValue} from './schema-codec';
import {validateInlineObjects} from './inline';

export type InlineValue=Readonly<{id:string;index:number;type:string;attrs:JsonValue}>;

export type InlineValueExtension<Layout>={name:string;version:number;parse:(attrs:unknown)=>JsonValue;plainText:(attrs:JsonValue)=>string;layout:(value:InlineValue)=>Layout};

export function createInlineSchema<Layout>(extensions:readonly InlineValueExtension<Layout>[]){
  const registry=new Map<string,InlineValueExtension<Layout>>();

  for(const extension of extensions){
    if(!extension.name||registry.has(extension.name)||!Number.isSafeInteger(extension.version)||extension.version<1)throw new Error('Invalid inline extension');
    registry.set(extension.name,extension);
  }

  function resolve(type:string){const extension=registry.get(type);

if(!extension)throw new Error(`Unknown inline type: ${type}`);

return extension;}

  function create(type:string,id:string,index:number,attrs:unknown):InlineValue{
    if(!id||!Number.isSafeInteger(index)||index<0)throw new Error('Invalid inline identity or offset');

    return {type,id,index,attrs:jsonValue(resolve(type).parse(attrs))};
  }

  return {
    create,
    layout:(value:InlineValue)=>resolve(value.type).layout(value),
    plainText:(value:InlineValue)=>resolve(value.type).plainText(value.attrs),
    encode(values:readonly InlineValue[]):JsonValue[]{return values.map(value=>({...create(value.type,value.id,value.index,value.attrs),version:resolve(value.type).version}));},
    decode(text:string,data:unknown):InlineValue[]{
      const values=jsonArray(data).map(raw=>{const value=jsonRecord(raw),type=jsonString(value.type);

if(value.version!==resolve(type).version)throw new Error('Unsupported inline version');

return create(type,jsonString(value.id),jsonNumber(value.index),value.attrs);});

      validateInlineObjects(text,values);

return values;
    },
  };
}
