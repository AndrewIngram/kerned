import { starterHtmlParsers } from '@gprose/starter-kit/browser';
import { createHtmlParser } from '@gprose/view';
import { expect, test } from 'vitest';

import { plainText } from '../demo-model.js';
import { demoSchema } from '../demo-schema.js';
import { loadEditorSample } from '../editor-samples.js';

test.each([
  { id: 'hayy-ibn-yaqzan', language: 'ar', blocks: 125, headings: 1, marks: 468, ltrBlocks: 0 },
  { id: 'tashlikh', language: 'he', blocks: 39, headings: 3, marks: 222, ltrBlocks: 4 },
  {
    id: 'journey-to-the-west',
    language: 'zh',
    blocks: 2968,
    headings: 101,
    marks: 0,
    ltrBlocks: 0,
  },
])('imports every $language book block without losing Unicode text', async (book) => {
  const response = await fetch(`/samples/${book.id}.html`);
  expect(response.ok).toBe(true);
  const document = new DOMParser().parseFromString(await response.text(), 'text/html');
  expect(document.documentElement.lang).toBe(book.language);
  expect(document.documentElement.dir).toBe(book.language === 'zh' ? 'ltr' : 'rtl');
  expect(document.querySelector('script, iframe, img, object, embed')).toBeNull();
  const content = document.querySelector('#book');

  if (!content) throw new Error('Missing book content');
  expect(content.children.length).toBe(book.blocks);
  expect(content.querySelectorAll('h1,h2').length).toBe(book.headings);
  expect([...content.textContent.matchAll(/\p{Mark}/gu)]).toHaveLength(book.marks);

  const nodes = createHtmlParser(demoSchema, starterHtmlParsers).parse(content.innerHTML);
  expect(nodes).toHaveLength(book.blocks);

  // BR elements denote line breaks, not text concatenation.
  for (const br of content.querySelectorAll('br')) br.replaceWith('\n');
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

  const texts = nodes.map((node) => {
    if (node.kind !== 'paragraph' && node.kind !== 'heading')
      throw new Error(`Unexpected book node ${node.kind}`);

    return normalize(plainText(node));
  });

  expect(texts).toEqual([...content.children].map((node) => normalize(node.textContent)));
  expect(nodes.filter((node) => node.kind === 'heading').length).toBe(book.headings);
  expect(document.querySelector('footer')?.textContent).toContain('source');
  expect(document.querySelector('link[rel="license"]')).not.toBeNull();

  expect(content.querySelectorAll('[lang="de"][dir="ltr"]').length).toBe(book.ltrBlocks);
});

test.each([
  { id: 'hayy-ibn-yaqzan', count: 125 },
  { id: 'tashlikh', count: 39 },
  { id: 'journey-to-the-west', count: 2968 },
])('streams only the book body of $id into the editor', async ({ id, count }) => {
  const sample = await loadEditorSample(new URL(`/editor.html?sample=${id}`, location.href));
  expect(sample.total).toBe(count);
  expect(sample.initial).toHaveLength(32);

  const text = sample
    .chunk(0, sample.total)
    .map((node) => {
      if (node.kind !== 'paragraph' && node.kind !== 'heading')
        throw new Error('Expected book text');

      return plainText(node);
    })
    .join('\n');

  expect(text).not.toContain('Browser-rendered reference');
  expect(text).not.toContain('source snapshot');
});
