import { defineContribution } from '../core';
import { createDocumentQuery } from '../editor-browser/document';
import type {
  InlineValue,
  MarkRange,
  NodeBinding,
  NodeIdentity,
  Schema,
  SchemaDefinition,
} from '../model';
import type { BlockPresentation } from './scene';
import { createThemeStyles, type ViewTheme } from './theme';

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

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
};

type PresentationRenderer<N> = {
  readonly name: string;
  read(node: N): NodePresentation;
};

export type PresentationContribution = {
  create<N extends NodeIdentity>(schema: Schema<N>): PresentationRenderer<N>;
};

/** View contributions are installed with the schema, but never executed by the headless core. */
export const presentations = defineContribution<PresentationContribution>();

/** The factory owns one view's presentation state, including configured typography. */
export function defineNodePresentation<D extends NodeDefinition>(
  definition: D,
  create: () => (attributes: Attributes<D>, context: PresentationContext) => NodePresentation,
): PresentationContribution {
  return {
    create<N extends NodeIdentity>(schema: Schema<N>): PresentationRenderer<N> {
      const binding = schema.node(definition);
      const render = create();

      return {
        name: definition.name,
        read(node) {
          const attributes = binding.read(node);

          if (!attributes)
            throw new Error(`Node does not match presentation for ${definition.name}`);
          const type = schema.resolve(node);

          const result = render(attributes, {
            identity: node,
            childCount: schema.children(node).length,
            marks: type.kind === 'text' ? (type.editing.marks?.read(node) ?? []) : [],
            inline: type.kind === 'text' ? (type.editing.inline?.read(node) ?? []) : [],
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
  const renderers = new Map<string, PresentationRenderer<N>>();

  for (const contribution of presentations.read(editor)) {
    const renderer = contribution.create(editor.schema);

    if (renderers.has(renderer.name))
      throw new Error(`Duplicate node presentation: ${renderer.name}`);
    renderers.set(renderer.name, renderer);
  }

  const defaults = new WeakMap<N, NodePresentation>();
  let style = createThemeStyles(editor.schema, theme, validateColor);
  let cache = new WeakMap<N, NodePresentation>();
  let version = 0;

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
    return createDocumentQuery<N, N, FlowContext>(editor.schema, {
      initial: { inset: 0 },
      isBlock: (node): node is N => read(node).kind !== 'flow',
      child(node, index, context) {
        const value = read(node);

        if (value.kind !== 'flow') throw new Error('Only flowing containers project children');

        return value.child(index, context);
      },
    });
  }

  let query = createQuery();

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
    },
    query: (state: Parameters<typeof query>[0]) => query(state),
    present(node: N): BlockPresentation {
      const value = read(node);

      if (value.kind === 'flow') throw new Error('A flowing container has no block geometry');

      return value;
    },
  };
}
