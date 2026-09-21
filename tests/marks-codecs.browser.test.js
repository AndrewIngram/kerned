import { test, expect } from 'vitest';

test('demo codecs preserve nested blocks, marks, mentions, locks and table structure', async () => {
  const result = await (async () => {
    const { demoDocumentCodec } = await import('../src/extensions/demo-schema.ts');
    const { createSampleDocument } = await import('../src/extensions/demo-model.ts');
    const { importHtml } = await import('../src/extensions/html.ts');

    const content = importHtml(
      '<h2>Title</h2><blockquote><p><strong>Bold</strong> <em>italic</em></p></blockquote><ol><li><p>Item</p><ul><li><p>Nested</p></li></ul></li></ol><table><tr><th>One</th><th>Two</th></tr><tr><td>A</td><td><u>B</u></td></tr></table>',
    ).nodes;

    content[0] = { ...content[0], locked: true };

    const encoded = demoDocumentCodec.encode(content),
      round = demoDocumentCodec.encode(
        demoDocumentCodec.decode(JSON.parse(JSON.stringify(encoded))),
      );

    const sample = createSampleDocument(),
      sampleEncoded = demoDocumentCodec.encode(sample),
      sampleRound = demoDocumentCodec.encode(
        demoDocumentCodec.decode(JSON.parse(JSON.stringify(sampleEncoded))),
      );

    const failures = [];

    for (const mutate of [
      (v) => (v.nodes[0].type = 'unknown'),
      (v) => (v.nodes[0].version = 999),
      (v) => (v.nodes[0].id = 1.5),
      (v) => (v.nodes[0].locked = 'true'),
      (v) => v.nodes.push(v.nodes[0]),
      (v) => v.nodes[0].children.push(v.nodes[1]),
      (v) => (v.nodes[0].data.level = 5),
    ]) {
      const value = structuredClone(encoded);
      mutate(value);

      try {
        demoDocumentCodec.decode(value);
        failures.push(false);
      } catch {
        failures.push(true);
      }
    }

    return {
      same: JSON.stringify(encoded) === JSON.stringify(round),
      sample: JSON.stringify(sampleEncoded) === JSON.stringify(sampleRound),
      failures,
      locked: round.nodes[0].locked,
    };
  })();

  expect(result).toEqual({
    same: true,
    sample: true,
    failures: [true, true, true, true, true, true, true],
    locked: true,
  });
});
