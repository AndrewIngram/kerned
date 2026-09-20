import type {ComponentProps} from 'react';
import {createReactRenderers} from '../editor-react';
import {TableBlock} from './table-view';
import {ImageBlock} from '../hybrid-image';
import {Checklist} from './checklist-view';
import {ParagraphExtensions} from './text-block-view';
import type {HybridLeaf} from './demo-model';

type NodeViewValue={
  node:HybridLeaf;
  table:Omit<ComponentProps<typeof TableBlock>,'node'>;
  image:Omit<ComponentProps<typeof ImageBlock>,'node'>;
  checklist:Omit<ComponentProps<typeof Checklist>,'node'>;
  text:ComponentProps<typeof ParagraphExtensions>;
};
/** Starter-kit registrations. The React integration does not know these node names. */
export const DemoNodeView=createReactRenderers<NodeViewValue>([
  {name:'table',component:({value})=>{if(value.node.kind!=='table')throw new Error('Expected table');return <TableBlock {...value.table} node={value.node}/>;}},
  {name:'image',component:({value})=>{if(value.node.kind!=='image')throw new Error('Expected image');return <ImageBlock {...value.image} node={value.node}/>;}},
  {name:'checklist',component:({value})=>{if(value.node.kind!=='checklist')throw new Error('Expected checklist');return <Checklist {...value.checklist} node={value.node}/>;}},
  {name:'paragraph',component:({value})=><ParagraphExtensions {...value.text}/>},
  {name:'heading',component:({value})=><ParagraphExtensions {...value.text}/>},
]);
