import { test, expect } from 'vitest';

test('clipboard HTML is a cropped rectangle and TSV preserves empty and quoted cells', async () => {
  const result = await (async () => {
    const { createEditor } = await import('./fixtures/table-clipboard.js');
    const { demoSchema } = await import('./fixtures/table-clipboard.js');
    const { createTable, tableCells } = await import('./fixtures/table-clipboard.js');

    const { writeClipboard, readClipboard, pasteFragment } =
      await import('./fixtures/table-clipboard.js');

    const { plainCellRectangle, cellRectangleText } = await import('./fixtures/table-clipboard.js');

    let next = 1;
    const allocate = () => ({ id: next++, key: crypto.randomUUID() });
    const table = structuredClone(createTable(demoSchema, allocate, 3, 3));
    table.rows[1][1].paragraphs[0].text = 'Bold';
    table.rows[1][1].paragraphs[0].marks = [
      { from: 0, to: 4, mark: { type: 'bold', attrs: null } },
    ];

    const editor = createEditor(
      demoSchema,
      [table],
      new tableCells.CellSelection(table.id, table.rows[2][2].id, table.rows[1][1].id),
      [tableCells.extension],
    );

    const data = new DataTransfer();
    writeClipboard(data, demoSchema, editor.state, 'ignored');
    const external = new DataTransfer();
    external.setData('text/html', data.getData('text/html'));

    const fragment = readClipboard(external, demoSchema),
      command = pasteFragment(demoSchema, editor.state, fragment, allocate);

    editor.dispatch({ baseRevision: 0, origin: 'local', history: 'separate', time: 0, ...command });

    const tsv = '"a\tb"\t"line 1\nline 2"\n"quote ""here"""\t\n',
      parsed = plainCellRectangle(demoSchema, tsv, allocate);

    return {
      html: data.getData('text/html'),
      plain: data.getData('text/plain'),
      dimensions: fragment.nodes[0].rows.map((row) => row.length),
      marks: editor.state.nodes[0].rows[1][1].paragraphs[0].marks,
      tsv: cellRectangleText(demoSchema, parsed),
      values: parsed.rows.map((row) => row.map((c) => c.paragraphs[0].text)),
    };
  })();

  expect(result.dimensions).toEqual([2, 2]);
  expect(result.html.match(/<tr>/g)).toHaveLength(2);
  expect(result.html).toContain('<strong>Bold</strong>');
  expect(result.plain).toBe('Bold\t\n\t');
  expect(result.marks[0].mark.type).toBe('bold');
  expect(result.values).toEqual([
    ['a\tb', 'line 1\nline 2'],
    ['quote "here"', ''],
  ]);
  expect(result.tsv).toBe('"a\tb"\t"line 1\nline 2"\n"quote ""here"""\t');
});
