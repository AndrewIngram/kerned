import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

// Offline conversion of the pinned source snapshots. Source markup is never mounted.
const directory = new URL('../apps/demo/public/samples/', import.meta.url);

const books = [
  {
    id: 'hayy-ibn-yaqzan',
    title: 'Hayy ibn Yaqzan',
    nativeTitle: 'حي بن يقظان',
    author: 'Ibn Tufayl',
    language: 'ar',
    sourceUrl:
      'https://ar.wikisource.org/w/index.php?title=%D8%AD%D9%8A_%D8%A8%D9%86_%D9%8A%D9%82%D8%B8%D8%A7%D9%86&oldid=374590',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution:
      'Ibn Tufayl; Arabic Wikisource contributors, revision 374590. Medieval work in the public domain; editorial contributions under CC BY-SA 4.0. The transcription does not identify its print edition.',
    contents: 'Complete narrative in the selected transcription; no invented chapters.',
  },
  {
    id: 'tashlikh',
    title: 'Tashlikh',
    nativeTitle: 'הצופה לבית ישראל: תשליך',
    author: 'Isaac Erter',
    language: 'he',
    sourceUrl: 'https://www.gutenberg.org/cache/epub/45252/pg45252-images.html',
    licenseUrl: 'tashlikh-source.html.txt',
    attribution:
      'Isaac Erter, 1840 Prague edition. Project Gutenberg ebook 45252, produced by Enrico Segre and the Distributed Proofreading team at DP-test Italia. Public-domain literary text. The original source snapshot includes the Project Gutenberg licence and transcription notes.',
    contents:
      'Title matter, introduction, complete satire and five footnotes; later transcription notes retained in the source snapshot.',
  },
];

const digest = (data) => createHash('sha256').update(data).digest('hex');

const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const browser = await chromium.launch();

async function convert(book) {
  const source = `${book.id}-source.html.txt`;
  const input = await readFile(new URL(source, directory));
  const page = await browser.newPage();

  const converted = await page.evaluate(
    ({ html, language, nativeTitle }) => {
      const document = new DOMParser().parseFromString(html, 'text/html');

      const root =
        language === 'ar' ? document.querySelector('.mw-parser-output .prose') : document.body;

      if (!root) throw new Error('Missing book text');

      for (const element of root.querySelectorAll('header, footer, #TN, script, style'))
        element.remove();
      const clean = (text) => text.replace(/\s+/g, ' ').trim();
      const compact = (text) => text.replace(/\s/g, '');

      const escape = (text) =>
        text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

      function inline(node) {
        if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent.replace(/\s+/g, ' '));

        if (node.nodeType === Node.COMMENT_NODE) return '';

        if (!(node instanceof Element)) throw new Error('Unexpected source node');

        if (node.tagName === 'BR') return '<br>';
        const content = [...node.childNodes].map(inline).join('');

        if (['I', 'EM', 'CITE'].includes(node.tagName)) return `<em>${content}</em>`;

        if (['B', 'STRONG'].includes(node.tagName)) return `<strong>${content}</strong>`;

        if (['SPAN', 'A', 'SUP'].includes(node.tagName)) return content;
        throw new Error(`Unexpected inline element ${node.tagName}`);
      }

      const sourceBlocks = [...root.querySelectorAll('h1, h2, p, .poetry')];

      const blocks = sourceBlocks.map((element) => {
        const lang = element.closest('[lang]')?.getAttribute('lang') ?? language;
        const direction = lang === 'de' ? 'ltr' : 'rtl';
        const attributes = `lang="${escape(lang)}" dir="${direction}"`;

        if (element.matches('.poetry')) {
          const lines = [...element.querySelectorAll('tr')].map((row) =>
            [...row.querySelectorAll('td')]
              .map((cell) => clean([...cell.childNodes].map(inline).join('')))
              .join(' '),
          );

          return `<p ${attributes}>${lines.join('<br>')}</p>`;
        }

        const tag = element.tagName.toLowerCase();

        return `<${tag} ${attributes}>${[...element.childNodes].map(inline).join('').trim()}</${tag}>`;
      });

      const content = blocks.join('\n');
      const output = document.createElement('template');
      output.innerHTML = content;
      const actual = [...output.content.children];

      if (
        actual.length !== sourceBlocks.length ||
        actual.some((node, i) => compact(node.textContent) !== compact(sourceBlocks[i].textContent))
      )
        throw new Error('Conversion changed text or block order');

      if (compact(root.textContent) !== compact(output.content.textContent))
        throw new Error('Conversion omitted source text outside known blocks');

      const title =
        language === 'ar' ? `<h1 lang="ar" dir="rtl">${escape(nativeTitle)}</h1>\n` : '';

      for (const br of output.content.querySelectorAll('br')) br.replaceWith('\n');
      const texts = [...output.content.children].map((node) => node.textContent);
      const text = texts.join('\n');

      return {
        content: title + content,
        blocks: blocks.length + Number(language === 'ar'),
        headings: output.content.querySelectorAll('h1,h2').length + Number(language === 'ar'),
        words: clean(text).split(/\s+/).length,
        combiningMarks: [...text.matchAll(/\p{Mark}/gu)].length,
        latinLetters: [...text.matchAll(/\p{Script=Latin}/gu)].length,
        digits: [...text.matchAll(/\p{Number}/gu)].length,
        sourceTextVerified: true,
      };
    },
    { html: input.toString('utf8'), ...book },
  );

  await page.close();
  assert.ok(converted.blocks > 30);
  assert.ok(converted.combiningMarks > 0);
  const { content, ...counts } = converted;

  const normalization =
    'Whitespace normalized; original letters, punctuation and combining marks preserved without Unicode normalization. Links and superscripts flattened to text; italics retained. Hebrew poem table becomes two lines. Arabic title added from source page title. Website navigation, images and source styling omitted.';

  const html = `<!doctype html>
<html lang="${book.language}" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="author" content="${escapeHtml(book.author)}">
<title>${escapeHtml(book.nativeTitle)} · ${book.title}</title>
<link rel="source" href="${escapeHtml(book.sourceUrl)}">
<link rel="license" href="${book.licenseUrl}">
<link rel="stylesheet" href="international-books.css">
</head>
<body>
<header lang="en" dir="ltr"><a href="international.html">International book samples</a><p>Browser-rendered reference. Canvas RTL integration is still in progress.</p></header>
<main id="book">
${content}
</main>
<footer lang="en" dir="ltr"><p>${escapeHtml(book.attribution)}</p><p><a href="${escapeHtml(book.sourceUrl)}">Source edition</a> · <a href="${book.licenseUrl}">Licence</a> · <a href="${source}">Unmodified source snapshot</a></p><p>${normalization}</p></footer>
</body>
</html>
`;

  await writeFile(new URL(`${book.id}.html`, directory), html);
  await writeFile(
    new URL(`${book.id}.json`, directory),
    JSON.stringify(
      {
        ...book,
        direction: 'rtl',
        source,
        sourceSha256: digest(input),
        htmlSha256: digest(html),
        ...counts,
        normalization,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(book.id, counts);
}

try {
  // Each conversion uses its own inert DOM and output files.
  await Promise.all(books.map(convert));
} finally {
  await browser.close();
}
