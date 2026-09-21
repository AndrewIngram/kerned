import type { ComponentProps } from 'react';

import { createReactRenderers } from '../editor-react';
import type { StarterLeaf } from './demo-model';
import { TableBlock } from './table-view';
import { ParagraphExtensions } from './text-block-view';

type NodeViewValue = {
  node: StarterLeaf;
  table: Omit<ComponentProps<typeof TableBlock>, 'node'>;
  text: ComponentProps<typeof ParagraphExtensions>;
};

/** Starter-kit registrations. The React integration does not know these node names. */
export const DemoNodeView = createReactRenderers<NodeViewValue>([
  {
    name: 'table',
    component: ({ value }) => {
      if (value.node.kind !== 'table') throw new Error('Expected table');

      return <TableBlock {...value.table} node={value.node} />;
    },
  },
  { name: 'paragraph', component: ({ value }) => <ParagraphExtensions {...value.text} /> },
  { name: 'heading', component: ({ value }) => <ParagraphExtensions {...value.text} /> },
]);
