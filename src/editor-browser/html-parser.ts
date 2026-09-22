import { defineContribution } from '@gprose/core';
import {
  snapTextOffset,
  normalizeMarks,
  validateTree,
  type Schema,
  type NodeIdentity,
  type SchemaDefinition,
  type Mark,
  type MarkRange,
  type InlineValue,
} from '@gprose/model';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export type ParsedHtmlText = Readonly<{
  text: string;
  marks: readonly MarkRange[];
  inline: readonly InlineValue[];
}>;

export type HtmlParseContext<N> = Readonly<{
  schema: Schema<N>;
  allocate(): NodeIdentity;
  text(element: ParentNode): ParsedHtmlText;
  blocks(element: ParentNode): N[];
}>;

type RuleMatch = Readonly<{ selector: string; priority?: number }>;

export type HtmlParseRule<N> = RuleMatch &
  (
    | {
        kind: 'text';
        fallback?: boolean;
        create(this: void, content: ParsedHtmlText, element: Element | null): N;
      }
    | { kind: 'node'; parse(element: Element): readonly N[] | null }
    | { kind: 'mark' | 'inline'; parse(element: Element): Mark | null }
  );

/** Rules are bound to an installed schema once. Their context owns each import's identities. */
export type HtmlParserContribution = {
  create<N extends NodeIdentity>(context: HtmlParseContext<N>): HtmlParseRule<N>;
};

export const htmlParsers = defineContribution<HtmlParserContribution>();

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

type ValueDefinition = Extract<SchemaDefinition, { category: 'mark' | 'inline' }>;

type Attributes<D extends NodeDefinition | ValueDefinition> = StandardSchemaV1.InferInput<
  D['spec']['attributes']
>;

export function defineHtmlTextParser<D extends NodeDefinition>(
  definition: D,
  options: RuleMatch & {
    fallback?: boolean;
    attributes(element: Element | null, text: string): Attributes<D>;
  },
): HtmlParserContribution {
  if (definition.spec.content.kind !== 'text') throw new Error('Text parser requires a text node');

  return {
    create(context) {
      const binding = context.schema.node(definition);

      return {
        kind: 'text',
        selector: options.selector,
        priority: options.priority,
        fallback: options.fallback,
        create(content, element) {
          return binding.create(
            context.allocate(),
            options.attributes(element, content.text),
            content,
          );
        },
      };
    },
  };
}

export function defineHtmlNodeParser<D extends NodeDefinition>(
  definition: D,
  options: RuleMatch & { attributes(element: Element): Attributes<D> | false },
): HtmlParserContribution {
  if (definition.spec.content.kind === 'text') throw new Error('Use a text parser for text nodes');
  const container = definition.spec.content.kind === 'container';

  return {
    create(context) {
      const binding = context.schema.node(definition);

      return {
        kind: 'node',
        selector: options.selector,
        priority: options.priority,
        parse(element) {
          const attributes = options.attributes(element);

          if (attributes === false) return null;

          return [
            binding.create(
              context.allocate(),
              attributes,
              container ? context.blocks(element) : [],
            ),
          ];
        },
      };
    },
  };
}

export function defineHtmlValueParser<D extends ValueDefinition>(
  definition: D,
  options: RuleMatch & { attributes(element: Element): Attributes<D> | false },
): HtmlParserContribution {
  return {
    create(context) {
      const binding = context.schema.value(definition);

      return {
        kind: definition.category,
        selector: options.selector,
        priority: options.priority,
        parse(element) {
          const attributes = options.attributes(element);

          return attributes === false ? null : binding.create(attributes);
        },
      };
    },
  };
}

const ignored = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'MATH',
  'VIDEO',
  'AUDIO',
  'SOURCE',
  'LINK',
  'META',
  'TITLE',
  'BASE',
]);

const blockTags = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'NAV',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'HR',
]);

/** Parse inert DOM through schema-bound rules. Unknown wrappers retain their text;
 * executable/resource subtrees are discarded before extension rules run. */
export function createHtmlParser<N extends NodeIdentity>(
  schema: Schema<N>,
  contributions: readonly HtmlParserContribution[],
) {
  let nextId = 1;
  let depth = 0;
  let inheritedMarks: readonly Mark[] = [];

  const context: HtmlParseContext<N> = {
    schema,
    allocate() {
      const id = nextId++;

      return { id, key: `html-${id}` };
    },
    text: (element) => readText(element),
    blocks: (element) => readBlocks(element),
  };

  const rules = contributions
    .map((entry) => entry.create(context))
    .toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const defaults = rules.filter((rule) => rule.kind === 'text' && rule.fallback);
  const fallback = defaults[0];

  if (defaults.length !== 1 || fallback.kind !== 'text')
    throw new Error('HTML parsing requires exactly one fallback text rule');

  const createFallback = fallback.create;

  function descend<T>(read: () => T): T {
    if (++depth > 256) {
      depth--;
      throw new Error('HTML import exceeds nesting limit');
    }

    try {
      return read();
    } finally {
      depth--;
    }
  }

  function activeMarks(element: Element, inherited: readonly Mark[]) {
    const found = new Map(inherited.map((mark) => [mark.type, mark]));
    const matched = new Set<string>();

    for (const rule of rules) {
      if (rule.kind !== 'mark' || !element.matches(rule.selector)) continue;
      const mark = rule.parse(element);

      if (mark && !matched.has(mark.type)) {
        found.set(mark.type, mark);
        matched.add(mark.type);
      }
    }

    return [...found.values()];
  }

  function withMarks<T>(marks: readonly Mark[], read: () => T): T {
    const previous = inheritedMarks;
    inheritedMarks = marks;

    try {
      return read();
    } finally {
      inheritedMarks = previous;
    }
  }

  function accumulator() {
    let text = '';
    const marks: MarkRange[] = [];
    const inline: InlineValue[] = [];

    function append(value: string, active: readonly Mark[], atom?: Mark) {
      if (!atom) {
        value = value.replace(/[\t\r\n\f ]+/g, ' ').replace(/\ufffc/g, '\ufffd');

        if (!text || /[ \n]$/.test(text)) value = value.replace(/^ /, '');
      }

      if (!value) return;
      const from = text.length;
      text += value;

      if (atom) inline.push({ ...atom, id: context.allocate().key, index: from });

      for (const mark of active) marks.push({ from, to: text.length, mark });
    }

    return {
      append,
      break(active: readonly Mark[]) {
        text = text.replace(/ $/, '');
        const from = text.length;
        text += '\n';

        for (const mark of active) marks.push({ from, to: text.length, mark });
      },
      finish(): ParsedHtmlText {
        text = text.replace(/ +$/, '');

        return {
          text,
          marks: normalizeMarks(
            marks.flatMap((mark) =>
              mark.from < text.length
                ? [
                    {
                      ...mark,
                      from: snapTextOffset(text, mark.from, -1),
                      to: snapTextOffset(text, Math.min(mark.to, text.length), 1),
                    },
                  ]
                : [],
            ),
          ),
          inline,
        };
      },
    };
  }

  type Accumulator = ReturnType<typeof accumulator>;

  function inlineNode(node: Node, output: Accumulator, active: readonly Mark[]) {
    if (node.nodeType === Node.TEXT_NODE) {
      output.append(node.textContent ?? '', active);

      return;
    }

    if (!(node instanceof Element) || ignored.has(node.tagName.toUpperCase())) return;

    if (node.tagName === 'BR') {
      output.break(activeMarks(node, active));

      return;
    }

    const marks = activeMarks(node, active);

    for (const rule of rules) {
      if (rule.kind !== 'inline' || !node.matches(rule.selector)) continue;
      const value = rule.parse(node);

      if (!value) continue;
      output.append('\ufffc', marks, value);

      return;
    }

    descend(() => {
      for (const child of node.childNodes) inlineNode(child, output, marks);
    });
  }

  function readText(element: ParentNode): ParsedHtmlText {
    const output = accumulator();

    const marks =
      element instanceof Element ? activeMarks(element, inheritedMarks) : inheritedMarks;

    for (const child of element.childNodes) inlineNode(child, output, marks);

    return output.finish();
  }

  function readBlocks(
    element: ParentNode,
    textRule?: Extract<HtmlParseRule<N>, { kind: 'text' }>,
    inherited = inheritedMarks,
  ): N[] {
    return descend(() => {
      const result: N[] = [];
      let pending = accumulator();

      function flush(force = false) {
        const content = pending.finish();

        if (force || (textRule ? content.text : content.text.trim()))
          result.push(
            textRule
              ? textRule.create(content, element instanceof Element ? element : null)
              : createFallback(content, null),
          );
        pending = accumulator();
      }

      function visit(node: Node, marks: readonly Mark[]) {
        if (!(node instanceof Element)) {
          inlineNode(node, pending, marks);

          return;
        }

        if (ignored.has(node.tagName.toUpperCase())) return;

        for (const rule of rules) {
          if ((rule.kind !== 'node' && rule.kind !== 'text') || !node.matches(rule.selector))
            continue;

          const nodes =
            rule.kind === 'text'
              ? readBlocks(node, rule, marks)
              : withMarks(activeMarks(node, marks), () => rule.parse(node));

          if (nodes === null) continue;
          flush();
          result.push(...nodes);

          return;
        }

        if (blockTags.has(node.tagName)) {
          flush();
          descend(() => {
            for (const child of node.childNodes) visit(child, activeMarks(node, marks));
          });
          flush();
        } else if (
          node.tagName === 'BR' ||
          rules.some((rule) => rule.kind === 'inline' && node.matches(rule.selector))
        )
          inlineNode(node, pending, marks);
        else
          descend(() => {
            const next = activeMarks(node, marks);

            for (const child of node.childNodes) visit(child, next);
          });
      }

      const marks = element instanceof Element ? activeMarks(element, inherited) : inherited;

      for (const child of element.childNodes) visit(child, marks);
      flush(!!textRule && result.length === 0);

      return result;
    });
  }

  function parseElement(element: ParentNode): N[] {
    if (depth) throw new Error('Cannot start another import during an active parse');

    if (element instanceof Element && ignored.has(element.tagName.toUpperCase())) return [];
    nextId = 1;
    const nodes = readBlocks(element);
    validateTree(schema, nodes);

    return nodes;
  }

  return {
    parseElement,
    parse(html: string): N[] {
      const template = document.createElement('template');
      template.innerHTML = html;

      return parseElement(template.content);
    },
  };
}

export function createEditorHtmlParser<N extends NodeIdentity>(editor: {
  schema: Schema<N>;
  isDestroyed: boolean;
}) {
  return createHtmlParser(editor.schema, htmlParsers.read(editor));
}
