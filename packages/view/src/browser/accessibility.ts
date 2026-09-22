import { defineContribution } from '@gprose/core';
import {
  textContent,
  type NodeBinding,
  type NodeIdentity,
  type Schema,
  type SchemaDefinition,
} from '@gprose/model';
import { TextSelection } from '@gprose/state';

import type { ViewSession } from './input-contributions.js';

/** Semantic roles, independent of the visual renderer and schema node names. */
export type NodeSemantics =
  | { kind: 'text' }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'group' | 'quote' | 'list-item' }
  | { kind: 'list'; ordered: boolean; start: number }
  | { kind: 'image'; label: string }
  | { kind: 'table'; caption: string }
  | { kind: 'cell'; row: number; header: boolean; colspan: number; rowspan: number };

type Definition = Extract<SchemaDefinition, { category: 'node' }>;

export type AccessibilityContribution = {
  create<N extends NodeIdentity>(
    schema: Schema<N>,
  ): {
    name: string;
    read(node: N): NodeSemantics;
  };
};

export const nodeAccessibility = defineContribution<AccessibilityContribution>();

/** Describe a schema definition without creating DOM or exposing arbitrary HTML. */
export function defineNodeAccessibility<D extends Definition>(
  definition: D,
  describe: (
    attributes: NonNullable<ReturnType<NodeBinding<NodeIdentity, D>['read']>>,
  ) => NodeSemantics,
): AccessibilityContribution {
  return {
    create(schema) {
      const binding = schema.node(definition);

      return {
        name: definition.name,
        read(node) {
          const attrs = binding.read(node);

          if (!attrs)
            throw new Error(`Node does not match accessibility definition ${definition.name}`);

          return describe(attrs);
        },
      };
    },
  };
}

function children(parent: HTMLElement, next: readonly HTMLElement[]) {
  for (const [index, element] of next.entries()) {
    if (parent.children[index] !== element)
      parent.insertBefore(element, parent.children[index] ?? null);
  }

  while (parent.children.length > next.length) parent.lastElementChild?.remove();
}

/** Full, opt-in reading projection. Its lifetime and cache are independent of canvas culling. */
export function createReadingView<N extends NodeIdentity>(
  document: Document,
  editor: ViewSession<N>,
  onError: (error: Error) => void,
) {
  const readers = new Map<string, { name: string; read(node: N): NodeSemantics }>();

  for (const contribution of nodeAccessibility.read(editor)) {
    const reader = contribution.create(editor.schema);

    if (readers.has(reader.name))
      throw new Error(`Duplicate accessibility definition ${reader.name}`);
    readers.set(reader.name, reader);
  }

  const root = document.createElement('section');
  root.dataset.editorReading = '';
  root.setAttribute('role', 'document');
  root.setAttribute('aria-label', 'Document reading view');
  root.tabIndex = 0;
  root.hidden = true;
  root.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';

  const cache = new Map<
    number,
    { node: N; access: string; element: HTMLElement; semantic: NodeSemantics | null }
  >();

  let enabled = false;

  function update() {
    if (!enabled) return;
    const seen = new Set<number>();

    function visit(node: N): HTMLElement {
      seen.add(node.id);
      // Check inherited access before reading attributes, children or inline labels.
      const access = editor.getAccess(node.id);
      let entry = cache.get(node.id);

      if (!entry || entry.node !== node || entry.access !== access) {
        const type = access === 'protected' || !access ? null : editor.schema.resolve(node);

        const semantic: NodeSemantics | null = type
          ? (readers.get(type.name)?.read(node) ?? {
              kind: type.kind === 'text' ? 'text' : 'group',
            })
          : null;

        const element = document.createElement(
          semantic?.kind === 'heading'
            ? `h${semantic.level}`
            : semantic?.kind === 'text'
              ? 'p'
              : semantic?.kind === 'quote'
                ? 'blockquote'
                : semantic?.kind === 'list'
                  ? semantic.ordered
                    ? 'ol'
                    : 'ul'
                  : semantic?.kind === 'list-item'
                    ? 'li'
                    : semantic?.kind === 'table'
                      ? 'table'
                      : semantic?.kind === 'cell'
                        ? semantic.header
                          ? 'th'
                          : 'td'
                        : 'div',
        );

        element.dataset.readingNode = String(node.id);
        element.dir = 'auto';

        if (!semantic) element.textContent = 'Protected content';
        else if (semantic.kind === 'image') {
          element.setAttribute('role', 'img');
          element.setAttribute('aria-label', semantic.label || 'Image');
        } else if (semantic.kind === 'list' && semantic.ordered)
          element.setAttribute('start', String(semantic.start));
        else if (semantic.kind === 'table')
          element.setAttribute('aria-label', semantic.caption || 'Table');
        else if (semantic.kind === 'cell') {
          element.setAttribute('colspan', String(semantic.colspan));
          element.setAttribute('rowspan', String(semantic.rowspan));

          if (semantic.header) element.setAttribute('scope', 'col');
        }

        if (type?.kind === 'text') {
          element.textContent = textContent(editor.schema, node);
          element.tabIndex = -1;
          element.setAttribute(
            'aria-description',
            access === 'editable' ? 'Activate to edit this block.' : 'Read-only block.',
          );
        }

        const previous = entry?.element;
        let retained: HTMLElement = element;

        if (previous?.tagName === element.tagName) {
          while (previous.attributes.length) previous.removeAttribute(previous.attributes[0].name);

          for (const attribute of element.attributes)
            previous.setAttribute(attribute.name, attribute.value);

          if (!type || type.kind !== 'container') {
            if (previous.textContent !== element.textContent)
              previous.textContent = element.textContent;
          }

          retained = previous;
        }

        entry = { node, access: access ?? 'protected', element: retained, semantic };
        cache.set(node.id, entry);
      }

      if (entry.semantic && editor.schema.resolve(node).kind === 'container') {
        const nested = editor.schema.children(node).map(visit);

        if (entry.semantic.kind === 'table') {
          const rows: HTMLElement[] = [];
          let row: number | undefined;
          const cells = new Map<HTMLElement, HTMLElement[]>();

          for (const cell of nested) {
            const description = cache.get(Number(cell.dataset.readingNode))?.semantic;
            // A protected cell stays a generic table cell without revealing its attributes.
            const index = description?.kind === 'cell' ? description.row : (row ?? 0);

            if (index !== row) {
              const oldRow = entry.element.children[rows.length];

              const tr =
                oldRow instanceof HTMLTableRowElement ? oldRow : document.createElement('tr');

              rows.push(tr);
              row = index;
            }

            const tr = rows.at(-1);

            if (!tr) throw new Error('Missing semantic table row');
            const value = description?.kind === 'cell' ? cell : document.createElement('td');

            if (value !== cell) value.append(cell);
            const current = cells.get(tr) ?? [];
            current.push(value);
            cells.set(tr, current);
          }

          for (const [tr, values] of cells) children(tr, values);
          children(entry.element, rows);
        } else children(entry.element, nested);
      }

      return entry.element;
    }

    children(root, editor.state.nodes.map(visit));

    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
  }

  function activate(event: Event) {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-reading-node]')
        : null;

    if (!target || !root.contains(target)) return;
    const id = Number(target.dataset.readingNode);

    if (editor.getAccess(id) !== 'editable') return;
    const node = editor.getNode(id);

    if (!node || editor.schema.text(node) === null) return;
    event.preventDefault();
    event.stopPropagation();
    editor.select(new TextSelection({ id, offset: 0 }));
    editor.commands.focus();
  }

  const key = (event: KeyboardEvent) => {
    if (event.key === 'Enter') activate(event);
  };

  root.addEventListener('click', activate);
  root.addEventListener('keydown', key);

  const detach = editor.on('update', (event) => {
    if (event.kind === 'selection' || event.kind === 'storedMarks') return;

    try {
      update();
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  });

  return {
    element: root,
    enable(value: boolean) {
      if (enabled === value) return;
      enabled = value;
      root.hidden = !value;

      if (value) update();
      else {
        root.replaceChildren();
        cache.clear();
      }
    },
    destroy() {
      detach();
      root.removeEventListener('click', activate);
      root.removeEventListener('keydown', key);
      root.remove();
      cache.clear();
    },
  };
}
