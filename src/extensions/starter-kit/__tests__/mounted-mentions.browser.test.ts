import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../../core';
import { defineNodePresentation, mountEditor, presentations } from '../../../editor-canvas';
import { createSchema, defineNode } from '../../../model';
import { textSelection } from '../../../state';
import { createMention, inlineSchema } from '../../mention';
import { starterBrowserExtensions, onMentionActivate, type MentionActivation } from '../browser';

const caption = defineNode({
  name: 'caption',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body', inline: 'tokens' },
  }),
});

const captionView = defineExtension({
  name: 'captionView',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(caption, () => (attrs, node) => ({
        kind: 'text',
        text: attrs.body,
        size: 18,
        lineHeight: 28,
        baselineGrid: 4,
        before: 0,
        after: 16,
        spans: [],
        atoms: node.inline.map(inlineSchema.layout),
      })),
    );

    return {};
  },
});

const schema = createSchema({ extensions: [...starterBrowserExtensions(), caption, captionView] });

function makeEditor(label: string) {
  return createEditor({
    schema,
    selection: textSelection(1, 0),
    content: [
      {
        kind: 'quote',
        id: 10,
        children: [1, 2].map((id) => ({
          kind: 'caption' as const,
          id,
          body: 'Hello \ufffc!',
          tokens: [
            createMention({
              id: 'shared-id',
              index: 6,
              label,
              width: 100,
              ascent: 24,
              descent: 6,
            }),
          ],
        })),
      },
    ],
  });
}

test('mentions render and activate through a custom inline field with session-local listeners', async ({
  onTestFinished,
}) => {
  const a = makeEditor('@Ada');
  const b = makeEditor('@Grace');
  const events: MentionActivation[] = [];
  const otherEvents: MentionActivation[] = [];
  const stop = onMentionActivate(a, (value) => events.push(value));
  onMentionActivate(b, (value) => otherEvents.push(value));

  const hosts = [a, b].map(() => {
    const host = document.createElement('div');
    host.style.cssText = 'width:400px;height:300px;';
    document.body.append(host);

    return host;
  });

  const first = mountEditor(hosts[0], { editor: a });
  const second = mountEditor(hosts[1], { editor: b });
  onTestFinished(() => {
    first.destroy();
    second.destroy();
    a.destroy();
    b.destroy();

    for (const host of hosts) host.remove();
  });
  await Promise.all([first.ready, second.ready]);
  const buttons = hosts[0].querySelectorAll<HTMLButtonElement>('[data-mention]');
  expect(buttons).toHaveLength(2);
  expect(buttons[0].getAttribute('aria-label')).toBe('Open @Ada');
  buttons[0].click();
  buttons[1].click();
  expect(events).toEqual([
    { nodeId: 1, id: 'shared-id', index: 6 },
    { nodeId: 2, id: 'shared-id', index: 6 },
  ]);
  expect(otherEvents).toEqual([]);
  const canvas = hosts[0].querySelector('canvas');
  const context = canvas?.getContext('2d');

  if (!canvas || !context) throw new Error('Missing software canvas');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const scale = devicePixelRatio;
  const buttonBounds = buttons[0].getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  const left = buttonBounds.left - canvasBounds.left;
  const top = buttonBounds.top - canvasBounds.top;
  expect([
    ...context.getImageData(Math.floor((left + 3) * scale), Math.floor((top + 10) * scale), 1, 1)
      .data,
  ]).toEqual([229, 237, 218, 255]);

  const pixels = context.getImageData(
    Math.floor((left + 6) * scale),
    Math.floor(top * scale),
    Math.floor(88 * scale),
    Math.floor(30 * scale),
  ).data;

  let dark = 0;

  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) dark++;
  expect(dark).toBeGreaterThan(10);
  stop();
  buttons[0].click();
  expect(events).toHaveLength(2);
  const stale: MentionActivation[] = [];
  onMentionActivate(a, (value) => stale.push(value));
  first.destroy();
  buttons[0].click();
  expect(stale).toEqual([]);
  expect(() => onMentionActivate(a, () => {})).not.toThrow();
  a.destroy();
  expect(() => onMentionActivate(a, () => {})).toThrow('live composed');
});
