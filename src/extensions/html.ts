import { createHtmlParser } from '@gprose/view';

import type { StarterNode } from './demo-model';
import { demoSchema } from './demo-schema';
import { starterHtmlParsers } from './html-parsers';

export type HtmlImport = {
  nodes: StarterNode[];
  tables: number;
  conversions: {
    headings: number;
    links: number;
    superscripts: number;
    subscripts: number;
    nestedTables: number;
  };
};

const parser = createHtmlParser(demoSchema, starterHtmlParsers);

/** Sample diagnostics are separate from the schema-bound parser used for clipboard import. */
export function importHtml(html: string): HtmlImport {
  const template = document.createElement('template');
  template.innerHTML = html;
  const ignored = 'script,style,template,noscript,iframe,object,embed,svg,math,video,audio';

  const count = (selector: string) =>
    [...template.content.querySelectorAll(selector)].filter((element) => !element.closest(ignored))
      .length;

  const tables = [...template.content.querySelectorAll('table')].filter(
    (element) => !element.closest(ignored) && element.rows.length,
  );

  const nestedTables = tables.filter((element) => element.parentElement?.closest('table')).length;

  return {
    nodes: parser.parseElement(template.content),
    tables: tables.length - nestedTables,
    conversions: {
      headings: count('h1,h2,h3,h4,h5,h6'),
      links: count('a'),
      superscripts: count('sup'),
      subscripts: count('sub'),
      nestedTables,
    },
  };
}
