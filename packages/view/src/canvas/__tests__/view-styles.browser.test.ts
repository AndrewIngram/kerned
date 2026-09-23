import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createSchema } from '@kerned/model';
import { mountEditor, viewStyles } from '@kerned/view';
import { expect, test } from 'vitest';

import { note, presentation } from '../../../../../tests/consumers/document.js';

const styling = defineExtension({
  name: 'styling',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(viewStyles, '[data-style-probe] { color: rgb(13, 27, 39); }');

    return {};
  },
});

const schema = createSchema({ extensions: [note, presentation, styling] });

test('styles belong to each mounted view and failed initialization releases them', async ({
  onTestFinished,
}) => {
  const hosts = Array.from({ length: 3 }, () => {
    const host = document.createElement('div');
    host.style.cssText = 'width:300px;height:300px';
    document.body.append(host);

    return host;
  });

  const editors = hosts.map(() =>
    createEditor({ schema, content: [{ kind: 'note', body: 'Text' }] }),
  );

  onTestFinished(() => {
    editors.forEach((editor) => editor.destroy());
    hosts.forEach((host) => host.remove());
  });
  const first = mountEditor(hosts[0], { editor: editors[0] });
  const second = mountEditor(hosts[1], { editor: editors[1] });
  await Promise.all([first.ready, second.ready]);
  expect(hosts[0].querySelectorAll('[data-editor-styles]')).toHaveLength(1);
  const probe = document.createElement('span');
  probe.dataset.styleProbe = '';
  hosts[1].append(probe);
  expect(getComputedStyle(probe).color).toBe('rgb(13, 27, 39)');
  first.destroy();
  expect(hosts[0].querySelector('[data-editor-styles]')).toBeNull();
  expect(getComputedStyle(probe).color).toBe('rgb(13, 27, 39)');
  second.destroy();
  expect(hosts[1].querySelector('[data-editor-styles]')).toBeNull();
  expect(getComputedStyle(probe).color).not.toBe('rgb(13, 27, 39)');

  const failed = mountEditor(hosts[2], {
    editor: editors[2],
    resolveAsset: () => {
      throw new Error('Asset unavailable');
    },
  });

  await expect(failed.ready).rejects.toThrow('Asset unavailable');
  expect(hosts[2].querySelector('[data-editor-styles]')).toBeNull();
  expect(editors[2].isDestroyed).toBe(false);
});
