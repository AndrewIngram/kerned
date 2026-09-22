# Arabic and Hebrew book sources

Research date: 2026-09-22. These choices provide substantial natural RTL prose
without relying on a modern translation's uncertain copyright status.

## Arabic: Hayy ibn Yaqzan

Use **حي بن يقظان**, by Ibn Tufayl, from Arabic Wikisource revision 374590.
Hindawi's catalogue independently identifies the original
publication as 1150, its edition as 2011, and the text as public domain. It lists
18,613 words. This is a philosophical novel with religious themes, rather than
a secular adventure story. [Publisher's catalogue](https://www.safahat.org/books/90463596/)

The publisher's [complete HTML text](https://www.safahat.org/books/90463596/1/)
has natural paragraphs and Arabic vowel marks. Its single continuous section
does not provide a chapter tree. The catalogue also links a
[downloadable EPUB](https://downloads.hindawi.org/books/90463596.epub).

Hindawi explicitly permits unrestricted use of the text of its public-domain
books while reserving book and cover design rights. Extract the prose and make
our own layout; do not redistribute the cover or publisher's layout. This
permission is distinct from its CC BY 4.0 policy for modern translations of
public-domain foreign works. [Publisher's reuse FAQ](https://www.safahat.org/faqs/)

The selected [Arabic Wikisource transcription](https://ar.wikisource.org/wiki/حي_بن_يقظان),
revision 374590, last edited 2021-08-31. Its underlying medieval work is public
domain, but the transcription does not identify a print source. The page footer
links [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Credit Ibn Tufayl and Wikisource contributors, link the
source and licence, describe format changes, and retain that licence for any
copyrightable editorial contributions in the converted text. Do not infer that
the application code must use this licence.

Availability: the implementation agent downloaded the fixed Wikisource revision
successfully. Hindawi/Safahat shell requests returned HTTP 403, despite the web
reader being able to read their pages. Wikisource's EPUB exporter returned a
bot-check page. Preserve the downloaded HTML as inert `.html.txt` source data
and extract the book text into our own document structure.

## Hebrew: Tashlikh

Use **הצופה לבית ישראל: תשליך**, by Isaac Erter, from Project Gutenberg ebook 45252. The catalogue gives Erter's dates as 1792–1851, classifies the work as
Hebrew satire, and marks it public domain in the USA.
[Catalogue](https://www.gutenberg.org/ebooks/45252)

The [UTF-8 HTML edition](https://www.gutenberg.org/cache/epub/45252/pg45252-images.html)
transcribes an 1840 Prague edition. It contains a reader's introduction, the
main satire, prose paragraphs, occasional niqqud, footnotes, and German title
matter. It is much shorter than a large novel, but it supplies genuine Hebrew
text and mixed-direction content. Its satire concerns religious hypocrisy; it
is not a religious instruction manual.

The UK copyright conclusion follows from the author's 1851 death and the
ordinary term of 70 years after death for literary works. The 1840 source
layout is also older than the separate 25-year published-edition term.
[UK government term guidance](https://www.gov.uk/copyright/how-long-copyright-lasts)

Gutenberg's catalogue only establishes US status. Its permission guidance
separates public-domain text from trademark conditions and allows crediting
Gutenberg as a source. Keep the original ebook's licence with any redistributed
source copy, and record text extraction in our attribution note.
[Gutenberg permissions](https://www.gutenberg.org/policy/permission.html)

## Sources not selected

- Gutenberg's [Hebrew Tales, ebook 5139](https://www.gutenberg.org/ebooks/5139)
  is marked copyrighted. Its author's age alone does not clear the translation.
- Hindawi's Arabic _Around the World in 80 Days_, book 72647050, looked suitable
  for vowel marks and chapters, but this research did not verify its current
  edition-specific licence from an accessible primary source. Do not treat a
  third-party repost's licence text as sufficient permission.
