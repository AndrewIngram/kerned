// Normalize the checked-in Gutenberg edition without executing source markup.
// Usage: node scripts/convert-war-and-peace.mjs [source.html] [output.html]
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const source=process.argv[2]??'public/samples/war-and-peace-full.html';
const output=process.argv[3]??'public/samples/war-and-peace.html';
const input=await readFile(source);
const browser=await chromium.launch();
let converted;
try{
  const page=await browser.newPage();
  converted=await page.evaluate(html=>{
    const template=document.createElement('template');template.innerHTML=html;
    const chapters=[...template.content.querySelectorAll('div.chapter')];
    if(chapters.length!==382)throw new Error('Expected 17 books/epilogues and 365 chapters');
    const clean=text=>text.replace(/\s+/g,' ').trim();
    const compact=text=>text.replace(/\s/g,'');
    const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    function inline(node){
      if(node.nodeType===Node.TEXT_NODE)return escape(node.textContent.replace(/\s+/g,' '));
      if(node.nodeType===Node.COMMENT_NODE)return '';
      if(!(node instanceof Element))throw new Error('Unexpected source node');
      if(node.tagName==='BR')return '<br>';
      if(node.tagName==='A'&&!node.textContent.trim())return '';
      if(node.tagName==='I')return `<em>${[...node.childNodes].map(inline).join('')}</em>`;
      throw new Error(`Unexpected inline source element ${node.tagName}`);
    }
    const blocks=[],expected=[];
    let books=0,chapterCount=0,footnotes=0,poems=0,preformatted=0;
    for(const chapter of chapters){
      if(chapter.firstElementChild?.tagName!=='H2')throw new Error('Missing section heading');
      for(const node of chapter.childNodes){
        if(node.nodeType===Node.COMMENT_NODE||node.nodeType===Node.TEXT_NODE&&!node.textContent.trim())continue;
        if(!(node instanceof Element))throw new Error('Unexpected text outside a source block');
        if(!node.textContent.trim())continue;
        expected.push(clean(node.textContent));
        if(node.tagName==='H2'){
          const isChapter=clean(node.textContent).startsWith('CHAPTER ');
          if(isChapter)chapterCount++;else books++;
          const tag=isChapter?'h3':'h2',id=node.querySelector('a[id]')?.id;
          if(!id)throw new Error('Missing section anchor');
          blocks.push(`<${tag} id="${escape(id)}">${clean(inlineText(node))}</${tag}>`);
        }else if(node.tagName==='P'){
          const kind=node.className;
          if(kind&&!['footnote','poem','noindent'].includes(kind))throw new Error(`Unexpected paragraph class ${kind}`);
          if(kind==='footnote')footnotes++;
          if(kind==='poem')poems++;
          blocks.push(`<p${kind?` class="${kind}"`:''}>${inlineText(node).trim()}</p>`);
        }else if(node.tagName==='PRE'){
          if(node.children.length)throw new Error('Unexpected markup in a preformatted passage');
          // Preserve lines and italics. Fixed-column spacing is normalized.
          const lines=node.textContent.trim().split(/\r?\n/).map(line=>escape(clean(line)));
          blocks.push(`<p class="preformatted"><em>${lines.join('<br>')}</em></p>`);preformatted++;
        }else throw new Error(`Unexpected block ${node.tagName}`);
      }
    }
    function inlineText(node){return [...node.childNodes].map(inline).join('');}
    const content=blocks.join('\n');
    const check=document.createElement('template');check.innerHTML=content;
    const actual=[...check.content.children].map(node=>clean(node.textContent));
    // BR creates a word boundary; compare non-whitespace to avoid losing any letters.
    if(actual.length!==expected.length||actual.some((value,index)=>compact(value)!==compact(expected[index])))throw new Error('Conversion changed book text or block order');
    if(compact(chapters.map(chapter=>chapter.textContent).join(''))!==compact(check.content.textContent))throw new Error('Conversion omitted source text');
    for(const br of check.content.querySelectorAll('br'))br.replaceWith(document.createTextNode('\n'));
    const texts=[...check.content.children].map(node=>clean(node.textContent));
    const sourceItalic=chapters.flatMap(chapter=>[...chapter.querySelectorAll('i,pre')]).map(node=>compact(node.textContent)).join('');
    const outputItalic=[...check.content.querySelectorAll('em')].map(node=>compact(node.textContent)).join('');
    if(sourceItalic!==outputItalic)throw new Error('Conversion changed italic text');
    return {content,blocks:blocks.length,words:texts.join(' ').split(/\s+/).length,books,chapters:chapterCount,footnotes,poems,preformatted,italicPassages:check.content.querySelectorAll('em').length,textVerified:true};
  },input.toString('utf8'));
}finally{await browser.close();}
assert.equal(converted.books,17);assert.equal(converted.chapters,365);
const {content,...counts}=converted;
const html=`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>War and Peace - Leo Tolstoy</title>
<meta name="author" content="Leo Tolstoy">
<meta name="translator" content="Louise and Aylmer Maude">
<link rel="source" href="https://www.gutenberg.org/ebooks/2600">
<link rel="license" href="war-and-peace-full.html#project-gutenberg-license">
<style>body{max-width:44rem;margin:3rem auto;padding:0 1.5rem;font:1.15rem/1.65 Georgia,serif}h2,h3{line-height:1.25;margin-top:2.5em}.footnote{font-size:.9em}.poem{margin-left:2em}</style>
</head>
<body>
${content}
</body>
</html>
`;
const digest=data=>createHash('sha256').update(data).digest('hex');
const manifest={title:'War and Peace',author:'Leo Tolstoy',translators:['Louise Maude','Aylmer Maude'],sourceUrl:'https://www.gutenberg.org/ebooks/2600',downloadUrl:'https://www.gutenberg.org/ebooks/2600.html.images',fullHtml:basename(source),sourceSha256:digest(input),htmlSha256:digest(html),...counts,headings:counts.books+counts.chapters,contents:'Complete novel, Book One through the Second Epilogue, including footnotes. The original download, credits, navigation and licence are preserved in the full HTML.',normalization:'Books and epilogues use h2, chapters use h3; i becomes em; preformatted passages become italic paragraphs with line breaks; empty layout paragraphs are removed; indentation and repeated whitespace, including fixed-column spacing, are normalized.'};
await writeFile(output,html);
await writeFile(output.replace(/\.html$/,'.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(manifest);
