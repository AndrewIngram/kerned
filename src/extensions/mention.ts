import type {InlineExtension,InlineObject} from '../editor';
import type {InlineAtom} from '../owned-inline';
export type MentionData = Pick<InlineAtom,'label'|'width'|'ascent'|'descent'>;
export type Mention = InlineObject<MentionData>;
export const mention:InlineExtension<MentionData,InlineAtom>={
  name:'mention',plainText:data=>data.label,
  layout:object=>({id:object.id,index:object.index,...object.data}),
};
export function createMention({id,index,...data}:InlineAtom):Mention{return {id,index,data};}
