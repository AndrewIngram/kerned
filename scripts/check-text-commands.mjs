import assert from 'node:assert/strict';

import { chromium, firefox, webkit } from 'playwright';

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5173/editor.html');
    await page.waitForFunction(() => window.editorDiagnostics);

    const result = await page.evaluate(async () => {
      const { textCommands } = await import('/src/extensions/text-commands.ts');
      const { createEditor, TextSelection } = await import('/@id/@gprose/state');
      const { demoSchema } = await import('/src/extensions/demo-schema.ts');

      const nodes = [1, 2].map((id) => ({
        kind: 'paragraph',
        id,
        key: `p${id}`,
        text: 'Alpha beta gamma',
        marks: [
          { from: 0, to: 16, mark: { type: 'bold', attrs: null } },
          { from: 0, to: 16, mark: { type: 'italic', attrs: null } },
        ],
        inline: [],
      }));

      const selection = new TextSelection({ id: 1, offset: 6 }, { id: 2, offset: 10 });
      const editor = createEditor(demoSchema, nodes, selection);

      const apply = (steps) =>
        editor.dispatch({
          baseRevision: editor.state.revision,
          origin: 'local',
          history: 'separate',
          time: performance.now(),
          steps,
        });

      apply(textCommands(demoSchema, editor.state).toggle('underline'));

      const underline = editor.state.nodes.every((n) =>
        n.marks.some((s) => s.mark.type === 'underline'),
      );

      const unchanged = editor.state.selection.eq(selection);
      apply(textCommands(demoSchema, editor.state).clear());

      const cleared =
        editor.state.nodes[0].marks.every((s) => s.to <= 6) &&
        editor.state.nodes[1].marks.every((s) => s.from >= 10);

      editor.undo();
      const restored = textCommands(demoSchema, editor.state).active('underline');

      const { captureComment, createCommentStore, commentDecorations } =
        await import('/src/extensions/comment.ts');

      const { resolveDecorations } = await import('/@id/@gprose/state');
      const store = createCommentStore();
      store.put(captureComment(demoSchema, editor, 'discussion', []));

      const annotations = resolveDecorations(
        commentDecorations(store.state.threads),
        editor.positions,
      ).resolved[0].ranges;

      apply([{ kind: 'replaceText', id: 1, from: 8, to: 8, text: 'new' }]);

      const expanded =
        resolveDecorations(commentDecorations(store.state.threads), editor.positions).resolved[0]
          .ranges[0].to === 19;

      editor.undo();

      const removed =
        resolveDecorations(commentDecorations(store.state.threads), editor.positions).resolved[0]
          .ranges[0].to === 16;

      editor.redo();
      const recovered = store.state.threads.length === 1;

      return { underline, unchanged, cleared, restored, annotations, expanded, removed, recovered };
    });

    for (const key of [
      'underline',
      'unchanged',
      'cleared',
      'restored',
      'expanded',
      'removed',
      'recovered',
    ])
      assert.equal(result[key], true, key);
    assert.deepEqual(
      result.annotations.map((c) => [c.from, c.to]),
      [
        [6, 16],
        [0, 10],
      ],
    );
    console.log(name, 'underline, clear formatting, cross-paragraph comments and undo/redo passed');
  } finally {
    await browser.close();
  }
}
