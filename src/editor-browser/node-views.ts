import { defineContribution } from '../core';
import type { NodeBinding, SchemaDefinition, NodeIdentity, Schema } from '../model';

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

export type NodeViewFrame<N> = {
  node: N;
  width: number;
  onMeasure: (id: number, width: number, height: number) => void;
};

export type NodeView<N> = {
  readonly isDestroyed: boolean;
  update(frame: NodeViewFrame<N>): void;
  destroy(): void;
};

type NodeViewRenderer<N> = {
  readonly name: string;
  matches(this: void, node: N): boolean;
  mount(element: HTMLDivElement): Omit<NodeView<N>, 'isDestroyed'>;
};

type MountedNodeRenderer<N> = Omit<NodeViewRenderer<N>, 'mount'> & {
  readonly isDestroyed: boolean;
  mount(element: HTMLDivElement): NodeView<N>;
};

export type NodeViewContribution = {
  create<N extends NodeIdentity>(schema: Schema<N>): NodeViewRenderer<N>;
};

/** The browser contract is defined here; the headless session only stores typed values. */
export const nodeViews = defineContribution<NodeViewContribution>();

type NodeViewAttributes<Definition extends NodeDefinition> = NonNullable<
  ReturnType<NodeBinding<NodeIdentity, Definition>['read']>
>;

/** A renderer binds to an installed definition family, including configured variants.
 * The factory owns per-view caches; each mounted node owns its DOM and cleanup.
 */
export function defineNodeView<Definition extends NodeDefinition>(
  definition: Definition,
  createRenderer: () => (element: HTMLDivElement) => {
    update(
      frame: NodeViewFrame<NodeIdentity> & { attributes: NodeViewAttributes<Definition> },
    ): void;
    destroy(): void;
  },
): NodeViewContribution {
  return {
    create<N extends NodeIdentity>(schema: Schema<N>): NodeViewRenderer<N> {
      const binding = schema.node(definition);
      const renderer = createRenderer();

      return {
        name: definition.name,
        matches: binding.matches,
        mount(element) {
          const view = renderer(element);

          return {
            update(frame) {
              const attributes = binding.read(frame.node);

              if (!attributes)
                throw new Error(`Node does not match renderer for ${definition.name}`);
              view.update({ ...frame, attributes });
            },
            destroy: () => view.destroy(),
          };
        },
      };
    },
  };
}

/** Resolve the session's contributions once per view, without a parallel renderer list. */
export function createNodeViews<N extends NodeIdentity>(
  editor: Parameters<typeof nodeViews.read>[0] & {
    readonly schema: Schema<N>;
    on(name: 'destroy', listener: () => void): () => void;
  },
) {
  const renderers = new Map<string, MountedNodeRenderer<N>>();

  for (const contribution of nodeViews.read(editor)) {
    const renderer = contribution.create(editor.schema);

    if (renderers.has(renderer.name)) throw new Error(`Duplicate node renderer: ${renderer.name}`);
    renderers.set(renderer.name, {
      get isDestroyed() {
        return editor.isDestroyed;
      },
      name: renderer.name,
      matches: renderer.matches,
      mount(element) {
        if (editor.isDestroyed) throw new Error('Editor is destroyed');
        const view = renderer.mount(element);
        let destroyed = false;
        let detach: (() => void) | undefined;

        function destroy() {
          if (destroyed) return;
          destroyed = true;
          detach?.();
          view.destroy();
        }

        try {
          if (editor.isDestroyed)
            throw new Error('Editor was destroyed while mounting a node view');
          detach = editor.on('destroy', destroy);
        } catch (error) {
          destroy();
          throw error;
        }

        return {
          get isDestroyed() {
            return destroyed;
          },
          update(frame) {
            if (destroyed || editor.isDestroyed) throw new Error('Node view is destroyed');
            view.update(frame);
          },
          destroy,
        };
      },
    });
  }

  return {
    find(node: N) {
      if (editor.isDestroyed) throw new Error('Editor is destroyed');
      const renderer = renderers.get(editor.schema.resolve(node).name);

      return renderer?.matches(node) ? renderer : undefined;
    },
  };
}
