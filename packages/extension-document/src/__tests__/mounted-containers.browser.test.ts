import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { list } from '@kerned/extension-document';
import { createSchema, defineNode, indexTree } from '@kerned/model';
import { starterBrowserExtensions } from '@kerned/starter-kit/browser';
import { textSelection } from '@kerned/state';
import { mountEditor, presentations, defineNodePresentation } from '@kerned/view';
import { expect, test } from 'vitest';
import { z } from 'zod';

const section = defineNode({
  name: 'section',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ inset: z.number() }),
    content: { kind: 'container', field: 'items', allowedGroups: ['block', 'list'] },
  }),
});

const sectionView = defineExtension({
  name: 'sectionView',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(section, () => (attributes) => ({
        kind: 'flow',
        child: (_index, inherited) => ({ inset: inherited.inset + attributes.inset }),
      })),
    );

    return {};
  },
});

test('the public mount renders nested list markers and quote rules through contributed layers', async ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema: createSchema({ extensions: [...starterBrowserExtensions(), section, sectionView] }),
    selection: textSelection(1, 0),
    content: [
      {
        kind: 'section',
        id: 100,
        inset: 40,
        items: [
          {
            kind: 'quote',
            id: 10,
            children: [
              {
                kind: 'list',
                id: 11,
                ordered: true,
                start: 4,
                children: [
                  {
                    kind: 'listItem',
                    id: 12,
                    children: [
                      { kind: 'paragraph', id: 1, text: 'First item' },
                      { kind: 'paragraph', id: 2, text: 'Continuation' },
                      {
                        kind: 'list',
                        id: 15,
                        ordered: false,
                        start: 1,
                        children: [
                          {
                            kind: 'listItem',
                            id: 16,
                            children: [{ kind: 'paragraph', id: 3, text: 'Nested item' }],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    kind: 'listItem',
                    id: 13,
                    children: [
                      { kind: 'paragraph', id: 4, text: 'Second item' },
                      {
                        kind: 'quote',
                        id: 20,
                        children: [{ kind: 'paragraph', id: 5, text: 'Nested quote' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      ...Array.from({ length: 70 }, (_, index) => ({
        kind: 'paragraph' as const,
        id: 200 + index,
        text: `Following ${index}`,
      })),
    ],
  });

  const host = document.createElement('div');
  host.style.cssText = 'width:620px;height:600px;';
  document.body.append(host);
  const view = mountEditor(host, { editor });
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  await view.ready;
  const marker = (id: number) => host.querySelector<HTMLElement>(`[data-block-decoration="${id}"]`);
  expect(marker(1)?.textContent).toBe('4.');
  expect(marker(2)).toBeNull();
  expect(marker(3)?.textContent).toBe('•');
  expect(marker(4)?.textContent).toBe('5.');
  expect(marker(5)).toBeNull();
  expect(marker(1)?.style.width).toBe('92px');
  expect(marker(3)?.style.width).toBe('120px');
  const outer = host.querySelector<HTMLElement>('[data-quote="10"]');
  const inner = host.querySelector<HTMLElement>('[data-quote="20"]');
  expect(outer?.style.left).toBe('68px');
  expect(inner?.style.left).toBe('120px');
  expect(outer?.getBoundingClientRect().height).toBeGreaterThan(
    inner?.getBoundingClientRect().height ?? 0,
  );
  expect(getComputedStyle(marker(1)?.firstElementChild ?? host).fontSize).toBe('18px');
  expect(getComputedStyle(outer ?? host).borderLeftWidth).toBe('3px');
  const before = marker(1);
  const node = indexTree(editor.schema, editor.state.nodes).byId.get(11)?.node;

  if (!node) throw new Error('Missing list');
  editor.transact((draft) => {
    draft.step({
      kind: 'updateBlock',
      node: editor.schema
        .node(list)
        .create(node, { ordered: true, start: 9 }, editor.schema.children(node)),
    });

    return true;
  });
  await expect.poll(() => marker(1)?.textContent).toBe('9.');
  expect(marker(1)).toBe(before);
  expect(marker(4)?.textContent).toBe('10.');
  editor.select(textSelection(269, 0));
  expect(await view.reveal({ id: 269, offset: 0 })).toBe(true);
  await expect
    .poll(() => host.querySelectorAll('[data-block-decoration], [data-quote]').length)
    .toBe(0);
  editor.select(textSelection(3, 0));
  expect(await view.reveal({ id: 3, offset: 0 })).toBe(true);
  expect(marker(1)?.textContent).toBe('9.');
  expect(marker(3)?.textContent).toBe('•');
  view.destroy();
  expect(host.childElementCount).toBe(0);
  expect(editor.isDestroyed).toBe(false);
});
