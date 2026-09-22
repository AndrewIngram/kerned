import { defineContribution } from '@gprose/core';
import type {
  InlineValue,
  MarkRange,
  NodeBinding,
  NodeIdentity,
  Schema,
  SchemaDefinition,
  ValueBinding,
} from '@gprose/model';

import { createDocumentQuery } from '../browser/document.js';
import type { InlineAtom } from '../internal/owned-inline.js';
import { emptySlotInsets, type SlotInsets, type FlowLayoutEvent } from './flow-layout.js';
import type { BlockPresentation } from './scene.js';
import { createThemeStyles, type ViewTheme } from './theme.js';

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

type InlineDefinition = Extract<SchemaDefinition, { category: 'inline' }>;

export type InlinePresentation = Pick<InlineAtom, 'width' | 'ascent' | 'descent' | 'label'>;

export type InlinePresentationContribution = {
  create<N extends NodeIdentity>(
    schema: Schema<N>,
  ): {
    readonly name: string;
    read(value: InlineValue): InlinePresentation;
  };
};

/** Inline allocation is supplied by the inline definition's browser extension. */
export const inlinePresentations = defineContribution<InlinePresentationContribution>();

export function defineInlinePresentation<D extends InlineDefinition>(
  definition: D,
  create: () => (
    attributes: NonNullable<ReturnType<ValueBinding<D>['read']>>['attrs'],
  ) => InlinePresentation,
): InlinePresentationContribution {
  return {
    create(schema) {
      const binding = schema.value(definition);
      const render = create();

      return {
        name: definition.name,
        read(value) {
          const bound = binding.read(value);

          if (!bound) throw new Error(`Inline does not match presentation for ${definition.name}`);

          return render(bound.attrs);
        },
      };
    },
  };
}

type Attributes<D extends NodeDefinition> = NonNullable<
  ReturnType<NodeBinding<NodeIdentity, D>['read']>
>;

export type FlowContext = Readonly<{ inset: number }>;

export type NodePresentation =
  | BlockPresentation
  | {
      kind: 'flow';
      child: (index: number, inherited: FlowContext) => FlowContext;
    };

export type PresentationContext = {
  readonly identity: NodeIdentity;
  readonly childCount: number;
  readonly marks: readonly MarkRange[];
  readonly inline: readonly InlineValue[];
  /** Allocate installed inline types without coupling a text node to their attributes. */
  layoutInline(): readonly InlineAtom[];
};

type PresentationRenderer<N> = {
  readonly name: string;
  read(node: N): NodePresentation;
};

export type PresentationContribution = {
  create<N extends NodeIdentity>(
    schema: Schema<N>,
    layoutInline: (values: readonly InlineValue[]) => readonly InlineAtom[],
  ): PresentationRenderer<N>;
};

/** View contributions are installed with the schema, but never executed by the headless core. */
export const presentations = defineContribution<PresentationContribution>();

/** The factory owns one view's presentation state, including configured typography. */
export function defineNodePresentation<D extends NodeDefinition>(
  definition: D,
  create: () => (attributes: Attributes<D>, context: PresentationContext) => NodePresentation,
): PresentationContribution {
  return {
    create<N extends NodeIdentity>(
      schema: Schema<N>,
      layoutInline: (values: readonly InlineValue[]) => readonly InlineAtom[],
    ): PresentationRenderer<N> {
      const binding = schema.node(definition);
      const render = create();

      return {
        name: definition.name,
        read(node) {
          const attributes = binding.read(node);

          if (!attributes)
            throw new Error(`Node does not match presentation for ${definition.name}`);
          const type = schema.resolve(node);

          const inline = type.kind === 'text' ? (type.editing.inline?.read(node) ?? []) : [];

          const result = render(attributes, {
            identity: node,
            childCount: schema.children(node).length,
            marks: type.kind === 'text' ? (type.editing.marks?.read(node) ?? []) : [],
            inline,
            layoutInline: () => layoutInline(inline),
          });

          if (result.kind === 'flow' && type.kind !== 'container')
            throw new Error(`Flow presentation requires a container: ${definition.name}`);

          return result;
        },
      };
    },
  };
}

/** Compile once per mounted view. Canonical nodes and snapshots remain owned by the session. */
export function createDocumentPresentation<N extends NodeIdentity>(
  editor: Parameters<typeof presentations.read>[0] & { readonly schema: Schema<N> },
  theme?: ViewTheme,
  validateColor?: (color: string) => void,
) {
  const inlineRenderers = new Map<string, ReturnType<InlinePresentationContribution['create']>>();

  for (const contribution of inlinePresentations.read(editor)) {
    const renderer = contribution.create(editor.schema);

    if (inlineRenderers.has(renderer.name))
      throw new Error(`Duplicate inline presentation: ${renderer.name}`);
    inlineRenderers.set(renderer.name, renderer);
  }

  function layoutInline(values: readonly InlineValue[]): readonly InlineAtom[] {
    return values.map((value) => {
      const renderer = inlineRenderers.get(value.type);

      if (!renderer) throw new Error(`Missing inline presentation: ${value.type}`);

      return { ...renderer.read(value), id: value.id, index: value.index };
    });
  }

  const renderers = new Map<string, PresentationRenderer<N>>();

  for (const contribution of presentations.read(editor)) {
    const renderer = contribution.create(editor.schema, layoutInline);

    if (renderers.has(renderer.name))
      throw new Error(`Duplicate node presentation: ${renderer.name}`);
    renderers.set(renderer.name, renderer);
  }

  const defaults = new WeakMap<N, NodePresentation>();
  let style = createThemeStyles(editor.schema, theme, validateColor);
  let cache = new WeakMap<N, NodePresentation>();
  let version = 0;
  const chrome = new Map<number, { key: string; insets: SlotInsets }>();

  function read(node: N) {
    let result = cache.get(node);

    if (!result) {
      const name = editor.schema.resolve(node).name;
      const renderer = renderers.get(name);

      if (!renderer) throw new Error(`Missing node presentation: ${name}`);
      let base = defaults.get(node);

      if (!base) {
        base = renderer.read(node);
        defaults.set(node, base);
      }

      result = style(node, base);
      cache.set(node, result);
    }

    return result;
  }

  function createQuery() {
    return createDocumentQuery<N, N, FlowContext & { endInset: number }>(editor.schema, {
      initial: { inset: 0, endInset: 0 },
      isBlock: (node): node is N => read(node).kind !== 'flow',
      child(node, index, context) {
        const value = read(node);

        if (value.kind !== 'flow') throw new Error('Only flowing containers project children');

        const child = value.child(index, context);
        const measured = chrome.get(node.id);
        const insets = measured?.key === node.key ? measured.insets : emptySlotInsets;

        return { inset: child.inset + insets.left, endInset: context.endInset + insets.right };
      },
    });
  }

  let query = createQuery();

  let compiled:
    | { projection: ReturnType<typeof query>['projection']; flows: readonly FlowLayoutEvent<N>[] }
    | undefined;

  function queryDocument(state: Parameters<typeof query>[0]) {
    const result = query(state);

    if (compiled?.projection !== result.projection) {
      for (const [id, value] of chrome) {
        if (result.tree.byId.get(id)?.node.key !== value.key) chrome.delete(id);
      }

      const flows = result.projection.flowEvents.map((event): FlowLayoutEvent<N> => {
        if (event.kind === 'close') return { kind: 'close', at: event.at, id: event.node.id };
        const inherited = result.projection.decorations.get(event.node.id);
        const measured = chrome.get(event.node.id);

        return {
          kind: 'open',
          at: event.at,
          to: result.spanFor(event.node.id)?.to ?? event.at,
          node: event.node,
          inset: inherited?.inset ?? 0,
          endInset: inherited?.endInset ?? 0,
          chrome: measured?.key === event.node.key ? measured.insets : emptySlotInsets,
        };
      });

      compiled = { projection: result.projection, flows };
    }

    return { ...result, flows: compiled.flows };
  }

  // Preserve snapshot identity across repeated reads by the layout owner.
  let snapshot: ReturnType<typeof queryDocument> | undefined;

  return {
    get version() {
      return version;
    },
    update(configuration: ViewTheme | undefined) {
      const next = createThemeStyles(editor.schema, configuration, validateColor);
      style = next;
      cache = new WeakMap();
      query = createQuery();
      version++;
      snapshot = undefined;
    },
    query(state: Parameters<typeof query>[0]) {
      if (snapshot?.editorState !== state) snapshot = queryDocument(state);

      return snapshot;
    },
    measure(node: N, insets: SlotInsets) {
      if (read(node).kind !== 'flow') throw new Error('Content slots require a flowing container');
      const previous = chrome.get(node.id);

      if (
        previous?.key === node.key &&
        previous.insets.top === insets.top &&
        previous.insets.right === insets.right &&
        previous.insets.bottom === insets.bottom &&
        previous.insets.left === insets.left
      )
        return false;
      chrome.set(node.id, { key: node.key, insets });
      query = createQuery();
      snapshot = undefined;
      version++;

      return true;
    },
    clear() {
      snapshot = undefined;
      compiled = undefined;
      chrome.clear();
      query = createQuery();
    },
    present(node: N): BlockPresentation {
      const value = read(node);

      if (value.kind === 'flow') throw new Error('A flowing container has no block geometry');

      return value;
    },
  };
}
