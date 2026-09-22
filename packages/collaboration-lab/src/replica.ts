import { defineExtension, type Editor, type ExtensionContext } from '@gprose/core';
import { indexTree, type NodeIdentity, type Schema, type SchemaDefinition } from '@gprose/model';
import { createStateField, TextSelection, type AccessPolicy } from '@gprose/state';
import type { Step } from '@gprose/transform';

import { createOptimisticRecipient } from './protected/optimistic.js';
import type { PresenceSelection } from './protocol.js';

type Session<N extends NodeIdentity> = Pick<
  Editor<readonly SchemaDefinition[], N>,
  'state' | 'dispatch' | 'select' | 'on' | 'destroy'
> & { schema: Schema<N> };

/** Experimental binding for text-only collaboration. Transport owns delivery;
 * the binding owns admission, optimistic selection and mounted reconciliation. */
export function createTextReplica<N extends NodeIdentity>(session: string) {
  const client = createOptimisticRecipient(session);
  const listeners = new Set<() => void>();
  const access = new Map<string, 'editable' | 'read-only' | 'protected'>();
  let applying = false;
  let refresh: (() => void) | null = null;
  let detach: (() => void) | null = null;
  let destroyed = false;
  let manifest = '';
  let failClosed: (() => void) | null = null;

  const field = createStateField<N, null>({
    create: () => null,
    update(value, event) {
      if (applying || event.kind === 'selection' || event.kind === 'permissions') return value;

      if (
        event.kind !== 'transaction' ||
        event.transaction.steps.some((step) => step.kind !== 'replaceText') ||
        event.after.storedMarks?.length
      )
        throw new Error(
          'This collaboration demo supports text edits within existing blocks. Formatting, structural edits and undo are not synchronized yet.',
        );

      return value;
    },
  });

  const extension = defineExtension({
    name: 'collaborativeText',
    options: {},
    setup(_options, _context: ExtensionContext<N>) {
      return { fields: [field] };
    },
  });

  function changed() {
    for (const listener of listeners) listener();
  }

  function active() {
    if (destroyed) throw new Error('Replica destroyed');
  }

  const permissions: AccessPolicy<N> = {
    access: (node) => (applying ? 'editable' : (access.get(node.key) ?? 'protected')),
  };

  return {
    extension,
    permissions,
    document(schema: Schema<N>, placeholder: (identity: NodeIdentity) => N) {
      active();

      if (refresh || client.status !== 'ready')
        throw new Error('Load a projection before creating the editor');
      const snapshot = client.snapshot();
      let id = 0;
      manifest = JSON.stringify(snapshot.manifest);
      access.clear();

      function children(parent: string | null): N[] {
        return snapshot.manifest
          .filter((item) => item.parent === parent)
          .map((item) => {
            const identity = { id: ++id, key: item.key };
            access.set(item.key, item.kind === 'protected' ? 'protected' : item.access);

            if (item.kind === 'protected') return placeholder({ ...identity, locked: item.locked });
            const body = snapshot.bodies[item.key];
            const codec = body && schema.extensions.find((type) => type.name === body.type)?.codec;

            if (!codec) throw new Error('Projection uses an unsupported node type');

            return codec.decode(body.data, { identity, children: children(item.key) });
          });
      }

      return children(null);
    },
    bind(editor: Session<N>) {
      active();

      if (refresh) throw new Error('Replica already bound');
      field.read(editor.state);
      failClosed = () => editor.destroy();

      function selection() {
        const value = editor.state.selection;
        const tree = indexTree(editor.schema, editor.state.nodes);

        if (!(value instanceof TextSelection)) return null;
        const anchor = tree.byId.get(value.anchor.id)?.node;
        const head = tree.byId.get(value.head.id)?.node;

        if (
          !anchor ||
          !head ||
          access.get(anchor.key) === 'protected' ||
          access.get(head.key) === 'protected'
        )
          return null;

        const first = tree.order.findIndex((item) => item.node.id === anchor.id);
        const last = tree.order.findIndex((item) => item.node.id === head.id);

        if (
          tree.order
            .slice(Math.min(first, last), Math.max(first, last) + 1)
            .some((item) => access.get(item.node.key) === 'protected')
        )
          return null;

        return {
          anchor: { key: anchor.key, offset: value.anchor.offset, association: 1 },
          head: { key: head.key, offset: value.head.offset, association: 1 },
        } satisfies PresenceSelection;
      }

      client.select(selection());
      refresh = () => {
        const tree = indexTree(editor.schema, editor.state.nodes);
        const steps: Step<N>[] = [];

        for (const { node } of tree.order) {
          const before = editor.schema.text(node);
          const after = client.text(node.key);

          if (before !== null && after !== undefined && before !== after)
            steps.push({ kind: 'replaceText', id: node.id, ...textDifference(before, after) });
        }

        const value = client.selection;
        const anchor = value && tree.byKey.get(value.anchor.key)?.node;
        const head = value && tree.byKey.get(value.head.key)?.node;

        const next =
          value && anchor && head
            ? new TextSelection(
                { id: anchor.id, offset: value.anchor.offset },
                { id: head.id, offset: value.head.offset },
              )
            : undefined;

        applying = true;

        try {
          if (steps.length)
            editor.dispatch({
              baseRevision: editor.state.revision,
              origin: 'local',
              history: 'separate',
              time: Date.now(),
              steps,
              selection: next,
            });
          else if (next && !next.eq(editor.state.selection)) editor.select(next);
        } finally {
          applying = false;
        }
      };

      const unsubscribe = editor.on('update', (event) => {
        if (applying) return;

        if (event.kind === 'transaction') {
          const tree = indexTree(editor.schema, event.before.nodes);

          for (const step of event.transaction.steps) {
            if (step.kind !== 'replaceText') throw new Error('Unsupported collaboration step');
            const node = tree.byId.get(step.id)?.node;

            if (!node) throw new Error('Missing collaboration node');
            client.edit({ key: node.key, from: step.from, to: step.to, text: step.text });
          }
        }

        client.select(selection());
        changed();
      });

      detach = unsubscribe;

      return () => {
        unsubscribe();
        refresh = null;
        detach = null;
      };
    },
    receive(bytes: Uint8Array) {
      active();
      const received = client.receive(bytes);

      if (received) {
        if (refresh && JSON.stringify(client.snapshot().manifest) !== manifest) {
          failClosed?.();
          throw new Error('Projection changed. Reconnect with a fresh editor.');
        }

        refresh?.();
        changed();
      }

      return received;
    },
    request: () => client.request(),
    presence: () => client.presence(),
    remoteSelections: () => client.remoteSelections(),
    get pending() {
      return client.pending;
    },
    takeResults: () => client.takeResults(),
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach?.();
      refresh = null;
      detach = null;
      client.destroy();
      listeners.clear();
      access.clear();
    },
  };
}

/** Keep replacement edges on graphemes, including combining and emoji sequences. */
function textDifference(before: string, after: string) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const left = [...segmenter.segment(before)].map((value) => value.segment);
  const right = [...segmenter.segment(after)].map((value) => value.segment);

  let start = 0,
    end = 0;

  while (start < left.length && start < right.length && left[start] === right[start]) start++;

  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  )
    end++;
  const from = left.slice(0, start).join('').length;

  return {
    from,
    to: before.length - left.slice(left.length - end).join('').length,
    text: right.slice(start, right.length - end).join(''),
  };
}
