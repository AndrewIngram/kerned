import * as Automerge from '@automerge/automerge';
import { indexTree, type NodeIdentity, type Schema } from '@kerned/model';
import { applySteps, type Step } from '@kerned/transform';
import { z } from 'zod';

import { documentCoordinates } from '../../../packages/collaboration-lab/src/coordinates.js';
import type { Edit, PresenceSelection } from '../../../packages/collaboration-lab/src/protocol.js';

const content = z.object({ texts: z.record(z.string(), z.string()) });

type Content = z.infer<typeof content>;

const cursor = z.object({
  key: z.string(),
  cursor: z.string(),
  snap: z.union([z.literal(-1), z.literal(1)]),
});

const reference = z.object({
  generation: z.string(),
  heads: z.array(z.string()),
  anchor: cursor,
  head: cursor,
});

export type CursorSelection = z.infer<typeof reference>;

export const parseCursorSelection = reference.parse.bind(reference);

export type Changes = { generation: string; changes: Automerge.Change[] };

export function createAutomergeSeed<N extends NodeIdentity>(
  schema: Schema<N>,
  nodes: readonly N[],
) {
  const texts = Object.fromEntries(
    indexTree(schema, nodes).order.flatMap(({ node }) => {
      const text = schema.text(node);

      return text === null ? [] : [[node.key, text]];
    }),
  );

  const doc = Automerge.from({ texts }, { actor: '00' });

  try {
    return Automerge.save(doc);
  } finally {
    Automerge.free(doc);
  }
}

/** Candidate-specific text storage and cursors. This is not an editor binding,
 * a permission server, or an implementation of our range-association contract. */
export function createAutomergePeer<N extends NodeIdentity>(options: {
  schema: Schema<N>;
  nodes: readonly N[];
  generation: string;
  actor: string;
  seed: Uint8Array;
}) {
  const { schema, generation } = options;
  let doc = Automerge.load<Content>(options.seed, { actor: options.actor });
  let nodes = options.nodes;

  const keys = indexTree(schema, nodes).order.flatMap(({ node }) =>
    schema.text(node) === null ? [] : [node.key],
  );

  function project() {
    const tree = indexTree(schema, nodes);
    const steps: Step<N>[] = [];

    if (Object.keys(doc.texts).length !== keys.length)
      throw new Error('Unsupported structural change');

    for (const key of keys) {
      const node = tree.byKey.get(key)?.node;
      const value = doc.texts[key];

      if (!node || value === undefined) throw new Error('Unsupported structural change');
      const before = schema.text(node);

      if (before !== null && before !== value)
        steps.push({ kind: 'replaceText', id: node.id, from: 0, to: before.length, text: value });
    }

    if (steps.length) nodes = applySteps(schema, nodes, steps).nodes;
  }

  try {
    content.parse(doc);
    project();
  } catch (error) {
    Automerge.free(doc);
    throw error;
  }

  return {
    get nodes() {
      return nodes;
    },
    edit(value: Edit): Changes {
      if (!documentCoordinates(schema, nodes).edit(value))
        throw new Error('Edit precondition failed');
      const before = doc;
      doc = Automerge.change(doc, (draft) =>
        Automerge.splice(
          draft,
          ['texts', value.key],
          value.from,
          value.to - value.from,
          value.text,
        ),
      );
      const changes = Automerge.getChanges(before, doc);
      project();

      return { generation, changes };
    },
    receive(message: Changes) {
      if (message.generation !== generation) throw new Error('Wrong document generation');
      [doc] = Automerge.applyChanges(doc, message.changes);
      project();
    },
    capture(value: PresenceSelection): CursorSelection {
      const normalized = documentCoordinates(schema, nodes).normalizeSelection(value);

      if (
        !normalized ||
        normalized.anchor.offset !== value.anchor.offset ||
        normalized.head.offset !== value.head.offset
      )
        throw new Error('Invalid selection boundary');

      function at(point: PresenceSelection['anchor']) {
        return {
          key: point.key,
          cursor: Automerge.getCursor(
            doc,
            ['texts', point.key],
            point.offset,
            point.association === -1 ? 'before' : 'after',
          ),
          snap: point.association,
        };
      }

      return {
        generation,
        heads: Automerge.getHeads(doc),
        anchor: at(value.anchor),
        head: at(value.head),
      };
    },
    resolve(
      value: CursorSelection,
    ):
      | { status: 'resolved'; selection: PresenceSelection }
      | { status: 'unavailable'; reason: 'generation' | 'dependencies' | 'cursor' } {
      if (value.generation !== generation) return { status: 'unavailable', reason: 'generation' };

      if (!Automerge.hasHeads(doc, value.heads))
        return { status: 'unavailable', reason: 'dependencies' };

      function point(endpoint: CursorSelection['anchor']) {
        return {
          key: endpoint.key,
          offset: Automerge.getCursorPosition(doc, ['texts', endpoint.key], endpoint.cursor),
          association: endpoint.snap,
        };
      }

      let selection: PresenceSelection;

      try {
        selection = { anchor: point(value.anchor), head: point(value.head) };
      } catch {
        return { status: 'unavailable', reason: 'cursor' };
      }

      const normalized = documentCoordinates(schema, nodes).normalizeSelection(selection);

      return normalized
        ? { status: 'resolved', selection: normalized }
        : { status: 'unavailable', reason: 'cursor' };
    },
    save() {
      return Automerge.save(doc);
    },
    destroy() {
      Automerge.free(doc);
    },
  };
}
