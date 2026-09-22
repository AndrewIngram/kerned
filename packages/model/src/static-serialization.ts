import type { SchemaDefinition } from './definitions.js';
import { renderHtml, type HtmlOutput } from './html-output.js';
import type { Mark } from './marks.js';
import type { NodeBinding, NodeDefinition } from './node-binding.js';
import type { NodeIdentity, Schema } from './schema.js';
import { validateTree } from './tree.js';
import type { ValueBinding, ValueDefinition } from './value-binding.js';

export type StaticContent = Readonly<{ html: readonly HtmlOutput[]; text: string }>;

export type StaticChild = Readonly<{
  content: StaticContent;
  read<D extends NodeDefinition>(definition: D): ReturnType<NodeBinding<NodeIdentity, D>['read']>;
}>;

type NodeFrame<D extends NodeDefinition> = Readonly<{
  attributes: NonNullable<ReturnType<NodeBinding<NodeIdentity, D>['read']>>;
  content: StaticContent;
  children: readonly StaticChild[];
}>;

type StaticSerializer<N> =
  | {
      category: 'node';
      name: string;
      render(node: N, content: StaticContent, children: readonly StaticChild[]): StaticContent;
    }
  | {
      category: 'mark' | 'inline';
      name: string;
      render(value: Mark, content: StaticContent): StaticContent;
    };

/** Bind static serialization independently of any interactive renderer or document session. */
export type SerializerContribution = {
  create<N extends NodeIdentity>(schema: Schema<N>): StaticSerializer<N>;
};

export function defineNodeSerializer<D extends NodeDefinition>(
  definition: D,
  render: (frame: NodeFrame<D>) => StaticContent,
): SerializerContribution {
  return {
    create(schema) {
      const binding = schema.node(definition);

      return {
        category: 'node',
        name: definition.name,
        render(node, content, children) {
          const attributes = binding.read(node);

          if (!attributes) throw new Error(`Unexpected node for ${definition.name} serializer`);

          return render({ attributes, content, children });
        },
      };
    },
  };
}

function defineValueSerializer<D extends ValueDefinition>(
  definition: D,
  render: (frame: {
    attributes: NonNullable<ReturnType<ValueBinding<D>['read']>>['attrs'];
    content: StaticContent;
  }) => StaticContent,
): SerializerContribution {
  return {
    create(schema) {
      const binding = schema.value(definition);

      return {
        category: definition.category,
        name: definition.name,
        render(value, content) {
          const bound = binding.read(value);

          if (!bound) throw new Error(`Unexpected value for ${definition.name} serializer`);

          return render({ attributes: bound.attrs, content });
        },
      };
    },
  };
}

export function defineMarkSerializer<D extends Extract<SchemaDefinition, { category: 'mark' }>>(
  definition: D,
  render: (frame: {
    attributes: NonNullable<ReturnType<ValueBinding<D>['read']>>['attrs'];
    content: StaticContent;
  }) => StaticContent,
) {
  return defineValueSerializer(definition, render);
}

export function defineInlineSerializer<D extends Extract<SchemaDefinition, { category: 'inline' }>>(
  definition: D,
  render: (attributes: NonNullable<ReturnType<ValueBinding<D>['read']>>['attrs']) => StaticContent,
) {
  return defineValueSerializer(definition, ({ attributes }) => render(attributes));
}

function textContent(text: string): StaticContent {
  return {
    text,
    html: text.split('\n').flatMap((line, index) => (index ? [{ tag: 'br' }, line] : [line])),
  };
}

export function createDocumentSerializer<N extends NodeIdentity>(
  schema: Schema<N>,
  contributions: readonly SerializerContribution[],
  { unsupported = 'reject' }: { unsupported?: 'reject' | 'text' } = {},
) {
  const nodes = new Map<string, Extract<StaticSerializer<N>, { category: 'node' }>>();
  const values = new Map<string, Extract<StaticSerializer<N>, { category: 'mark' | 'inline' }>>();

  for (const contribution of contributions) {
    const serializer = contribution.create(schema);
    const key = `${serializer.category}:${serializer.name}`;

    if (serializer.category === 'node') {
      if (nodes.has(serializer.name)) throw new Error(`Duplicate serializer: ${key}`);
      nodes.set(serializer.name, serializer);
    } else {
      if (values.has(key)) throw new Error(`Duplicate serializer: ${key}`);
      values.set(key, serializer);
    }
  }

  function value(category: 'mark' | 'inline', data: Mark, content: StaticContent) {
    const serializer = values.get(`${category}:${data.type}`);

    if (serializer) return serializer.render(data, content);

    if (unsupported === 'reject') throw new Error(`Missing serializer: ${category}:${data.type}`);

    return content;
  }

  function render(node: N, depth: number): StaticContent {
    if (depth > 256) throw new Error('Serialization exceeds nesting limit');
    const type = schema.resolve(node);
    const serializer = nodes.get(type.name);

    if (!serializer && unsupported === 'reject')
      throw new Error(`Missing serializer: node:${type.name}`);

    const children: StaticChild[] = schema.children(node).map((child) => ({
      content: render(child, depth + 1),
      read: (definition) => schema.node(definition).read(child),
    }));

    let content: StaticContent;

    if (type.kind === 'text') {
      const text = type.editing.text(node);
      const marks = type.editing.marks?.read(node) ?? [];
      const inline = type.editing.inline?.read(node) ?? [];
      const byOffset = new Map(inline.map((item) => [item.index, item]));

      const edges = [
        ...new Set([
          0,
          text.length,
          ...marks.flatMap((range) => [range.from, range.to]),
          ...inline.flatMap((item) => [item.index, item.index + 1]),
        ]),
      ].toSorted((a, b) => a - b);

      const parts: StaticContent[] = [];

      for (let index = 0; index < edges.length - 1; index++) {
        const from = edges[index],
          to = edges[index + 1];

        const atom = byOffset.get(from);

        let part = atom
          ? value('inline', atom, textContent(type.editing.inline?.plainText(atom) ?? ''))
          : textContent(text.slice(from, to));

        for (const range of marks)
          if (range.from <= from && range.to >= to) part = value('mark', range.mark, part);
        parts.push(part);
      }

      content = {
        html: parts.flatMap((part) => part.html),
        text: parts.map((part) => part.text).join(''),
      };
    } else
      content = {
        html: children.flatMap((child) => child.content.html),
        text: children.map((child) => child.content.text).join('\n'),
      };

    if (serializer) return serializer.render(node, content, children);

    return type.kind === 'text'
      ? { ...content, html: [{ tag: 'p', children: content.html }] }
      : content;
  }

  return {
    serialize(document: readonly N[]) {
      validateTree(schema, document);
      const parts = document.map((node) => render(node, 0));

      return {
        html: renderHtml(parts.flatMap((part) => part.html)),
        text: parts.map((part) => part.text).join('\n\n'),
      };
    },
  };
}
