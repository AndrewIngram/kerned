import { createTextReplica } from '@kerned/collaboration-lab';
import { createProtectedAuthority } from '@kerned/collaboration-lab/authority';
import { remotePresence, protectedContent } from '@kerned/collaboration-lab/browser';
import { createEditor } from '@kerned/core';
import { paragraph, heading } from '@kerned/extension-document';
import { createSchema, type DocumentNode } from '@kerned/model';
import { starterDefinitions } from '@kerned/starter-kit';
import { starterBrowserExtensions } from '@kerned/starter-kit/browser';
import { textSelection } from '@kerned/state';

const schema = createSchema({ extensions: starterDefinitions });

type Node = DocumentNode<typeof starterDefinitions>;

const alice = { name: 'Alice', role: 'Full access', color: '#7c5ccc', background: '#e8dffc' };

const bob = { name: 'Bob', role: 'Limited access', color: '#208676', background: '#ccece6' };

/** A local, byte-delivery laboratory. Each editor only receives its principal's
 * projection. This same-page authority is not a deployed authentication server. */
export function createCollaborationRoom() {
  const paragraphType = schema.node(paragraph);

  const authority = createProtectedAuthority({
    schema,
    delivery: { kind: 'json' },
    users: { alice: 'editable', bob: 'editable' },
    comments: [],
    attachments: [],
    title: () => null,
    nodes: [
      schema.node(heading).create({ id: 1, key: 'title' }, { level: 1, text: 'Room to think' }),
      paragraphType.create(
        { id: 2, key: 'intro' },
        {
          text: 'Good ideas get better when we work on them together. Try writing in either editor.',
        },
      ),
      paragraphType.create(
        { id: 3, key: 'experiment' },
        {
          text: 'Select a few words to share your place. Pause delivery, make edits in both panes, then resume to bring them together.',
        },
      ),
      paragraphType.create(
        { id: 4, key: 'private' },
        {
          text: 'Private note: the launch code is MARIGOLD. This text is only delivered to Alice.',
        },
      ),
      paragraphType.create(
        { id: 5, key: 'closing' },
        { text: 'There is room here for another thought.' },
      ),
    ],
  });

  authority.setAccess('bob', 'private', 'protected');

  let paused = false,
    scheduled = false,
    pumping = false,
    destroyed = false;

  let message = '';
  const listeners = new Set<() => void>();
  let snapshot = { paused: false, pending: 0, message: '' };

  function connect(principal: string, profile: typeof alice, peer: typeof alice) {
    const frames: Uint8Array[] = [];
    const connection = authority.connect(principal, (bytes) => frames.push(bytes));
    const replica = createTextReplica<Node>(connection.session);
    connection.flush();

    for (const bytes of frames.splice(0)) replica.receive(bytes);

    const clientSchema = createSchema({
      extensions: [
        ...starterBrowserExtensions({ bodySize: 18 }),
        replica.extension,
        protectedContent,
        remotePresence(replica, {
          label: peer.name,
          color: peer.color,
          background: peer.background,
        }),
      ],
    });

    const editor = createEditor({
      schema: clientSchema,
      document: replica.document(clientSchema, (identity) =>
        clientSchema.node(paragraph).create(identity, { text: '' }),
      ),
      permissions: replica.permissions,
      selection: textSelection(2, 0),
    });

    replica.bind(editor);

    const unsubscribe = replica.subscribe(() => {
      if (!pumping) schedule();
    });

    return { profile, editor, replica, connection, frames, unsubscribe };
  }

  const clients = [connect('alice', alice, bob), connect('bob', bob, alice)];

  function publish() {
    snapshot = {
      paused,
      pending: clients.reduce((count, client) => count + client.replica.pending, 0),
      message,
    };

    for (const listener of listeners) listener();
  }

  function deliver() {
    for (const client of clients) client.connection.flush();

    for (const client of clients) {
      for (const bytes of client.frames.splice(0)) client.replica.receive(bytes);

      if (client.replica.takeResults().some((result) => result.kind === 'discarded'))
        message =
          'Overlapping edits conflicted. The confirmed version is shown; an unconfirmed edit was discarded.';
    }
  }

  function pump() {
    scheduled = false;

    if (destroyed) return;

    if (paused) {
      publish();

      return;
    }

    pumping = true;

    try {
      // Submit both heads before delivery so delayed peers genuinely rebase.
      for (const client of clients) {
        const bytes = client.replica.request();

        if (bytes) client.connection.submit(bytes);
      }

      // Reconcile acknowledgements first: a caret inside a newly confirmed
      // insertion can now be sent in confirmed document coordinates.
      deliver();

      for (const client of clients) {
        const bytes = client.replica.presence();

        if (bytes) client.connection.presence(bytes);
      }

      deliver();
    } finally {
      pumping = false;
    }

    publish();

    if (clients.some((client) => client.replica.pending)) schedule();
  }

  function schedule() {
    if (scheduled || destroyed) return;
    scheduled = true;
    queueMicrotask(pump);
  }

  schedule();

  return {
    clients: clients.map(({ editor, profile }) => ({ editor, profile })),
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    toggleDelivery() {
      paused = !paused;
      schedule();
      publish();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;

      for (const client of clients) {
        client.unsubscribe();
        client.replica.destroy();
        client.editor.destroy();
        client.connection.close();
      }

      authority.destroy();
      listeners.clear();
    },
  };
}
