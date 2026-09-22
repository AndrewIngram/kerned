import { test, expect } from '@playwright/test';

test('dragging from an image and shift-clicking it creates a usable structural selection', async ({
  page,
}) => {
  await page.goto('/extensions.html?stream=32');
  await page.waitForFunction(() => window.editorDiagnostics);

  const setup = await page.evaluate(() => {
    const nodes = window.editorDiagnostics.read().nodes,
      index = nodes.findIndex((n) => n.kind === 'image');

    window.editorDiagnostics.scrollTo(nodes[index].id);

    return { image: nodes[index].id, before: nodes[index - 1].id, after: nodes[index + 1].id };
  });

  const image = page.locator(`[data-image="${setup.image}"]`);
  await image.scrollIntoViewIfNeeded();
  await image.click();
  await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBe('range');
  await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBe('range');
  await page.keyboard.type('Replacement');
  expect(
    await page.evaluate(
      (id) => window.editorDiagnostics.read().nodes.some((n) => n.id === id),
      setup.image,
    ),
  ).toBe(false);
  const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

  // Typing the replacement and subsequent characters can occupy separate groups.
  for (
    let i = 0;
    i < 3 &&
    !(await page.evaluate(
      (id) => window.editorDiagnostics.read().nodes.some((n) => n.id === id),
      setup.image,
    ));
    i++
  )
    await page.keyboard.press(undo);
  await expect(image).toBeVisible();
  await page.evaluate((id) => window.editorDiagnostics.scrollTo(id), setup.before);
  await page.evaluate((id) => window.editorDiagnostics.select(id, 0), setup.before);
  await image.click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBe('range');
  const bounds = await image.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 10, Math.max(110, bounds.y - 25), { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBe('range');

  const clipboard = await page.evaluate(async () => {
    const event = new ClipboardEvent('copy', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
      input = document.querySelector('[data-editor-input]');

    input.dispatchEvent(event);
    const data = event.clipboardData;

    return {
      plain: data.getData('text/plain'),
      token: data.getData('application/x-gprose-fragment'),
    };
  });

  expect(clipboard.token).not.toBe('');
  expect(clipboard.plain).toContain('Landscape illustration');
});

test('node-only document supports drag, shift reversal and document-edge extension', async ({
  page,
}) => {
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.editorDiagnostics);
  await page.evaluate(async () => {
    const { schema } = await import('/tests/fixtures/editor-foundation.js');
    const { createEditor, NodeSelection, selectionContext } = await import('/@id/@gprose/state');
    const { mountEditorView, createTextInteraction } = await import('/src/editor-browser/index.ts');

    const nodes = [
        { id: 1, key: 'one', kind: 'atom' },
        { id: 2, key: 'two', kind: 'atom' },
      ],
      editor = createEditor(schema, nodes, new NodeSelection(1));

    const context = selectionContext(schema, nodes),
      interaction = createTextInteraction(),
      root = document.createElement('div');

    root.style.cssText = 'position:fixed;inset:100px 100px auto;z-index:100;background:white';
    root.innerHTML =
      '<div data-atom="1" style="height:80px">One</div><div data-atom="2" style="height:80px">Two</div><textarea aria-label="Atom capture" style="position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01"></textarea>';
    document.body.append(root);
    const input = root.querySelector('textarea');
    let view;

    function options() {
      const binding = interaction.bind({
        selection: editor.state.selection,
        context,
        nodes: () => nodes.map((n) => ({ id: n.id, text: null, selectable: true })),
        nodeAt: (target) =>
          Number(target.closest('[data-atom]')?.getAttribute('data-atom')) || null,
        select(selection) {
          editor.select(selection);
          view.update(options());
        },
        breakHistory() {},
        focus() {
          input.focus({ preventScroll: true });
        },
        reveal() {},
        point: () => null,
        regions: () => [],
        text: () => null,
        blocks: () => [],
        layout() {
          throw new Error('Atoms have no text layout');
        },
        viewportHeight: 500,
      });

      return {
        pointer: binding.pointer,
        input: { element: () => input, keydown: binding.keydown },
      };
    }

    view = mountEditorView(root, options());
    window.atomProbe = () => ({
      type: editor.state.selection.type,
      ranges: editor.state.selection.ranges(context),
    });
  });
  await page.locator('[data-atom="1"]').click();
  await page.keyboard.press('Shift+ArrowRight');
  expect((await page.evaluate(() => window.atomProbe())).ranges).toEqual([
    { kind: 'node', id: 1 },
    { kind: 'node', id: 2 },
  ]);
  await page.keyboard.press('Shift+ArrowLeft');
  expect((await page.evaluate(() => window.atomProbe())).ranges).toEqual([{ kind: 'node', id: 1 }]);
  await page.keyboard.press('Shift+ArrowRight');
  expect((await page.evaluate(() => window.atomProbe())).ranges).toHaveLength(2);
  await page.locator('[data-atom="2"]').click();
  await page.keyboard.press('Control+Shift+Home');
  expect((await page.evaluate(() => window.atomProbe())).ranges).toHaveLength(2);

  const one = await page.locator('[data-atom="1"]').boundingBox(),
    two = await page.locator('[data-atom="2"]').boundingBox();

  await page.mouse.move(two.x + 20, two.y + 40);
  await page.mouse.down();
  await page.mouse.move(one.x + 20, one.y + 40, { steps: 6 });
  await page.mouse.up();
  expect((await page.evaluate(() => window.atomProbe())).ranges).toHaveLength(2);
});
