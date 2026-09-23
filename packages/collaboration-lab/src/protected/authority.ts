import { indexTree, type NodeIdentity, type Schema } from '@kerned/model';
import { projectDocument, type NodeAccess, type ProjectedNode } from '@kerned/state';
import type { Step } from '@kerned/transform';

import { documentCoordinates } from '../coordinates.js';
import { mapSelection, type PresenceSelection } from '../protocol.js';
import { createProjectedDocument } from './document.js';
import type { createPartitions } from './partitions.js';
import {
  bodySchema,
  encodeFrame,
  decodeProposal,
  decodePresence,
  type ProjectedPresence,
  encodeReceipt,
  type ProjectedProposal,
  type AttachmentResult,
  type Body,
  type Frame,
  type Manifest,
  type Update,
} from './wire.js';

type Comment = { id: string; from: string; to: string; text: string; readKeys: readonly string[] };

type Attachment = { id: string; key: string; body: string };

/** Restricted delivery and text admission proof. Connections own principal
 * identity; callers never receive the canonical tree or native history. */
export function createProtectedAuthority<N extends NodeIdentity>(options: {
  schema: Schema<N>;
  nodes: readonly N[];
  delivery:
    | { kind: 'json' }
    | { kind: 'automerge'; partitions: ReturnType<typeof createPartitions> };
  users: Readonly<Record<string, NodeAccess>>;
  comments: readonly Comment[];
  attachments: readonly Attachment[];
  title: (node: N) => string | null;
}) {
  const { schema } = options;

  const users = new Map(Object.entries(options.users));
  const access = new Map<string, Map<string, NodeAccess>>();
  const comments = structuredClone(options.comments);
  const attachments = new Map(options.attachments.map((item) => [item.id, structuredClone(item)]));
  const partitions = options.delivery.kind === 'automerge' ? options.delivery.partitions : null;
  const presence = new Map<string, PresenceSelection>();
  const connections = new Set<() => void>();

  let epoch = 1,
    sessionCount = 0,
    destroyed = false;

  const document = createProjectedDocument({
    schema,
    nodes: options.nodes,
    epoch: () => epoch,
    changed(structural, edits) {
      if (structural) rotate();
      else
        for (const [id, value] of presence) {
          let selection: PresenceSelection | null = value;

          for (const edit of edits) selection = mapSelection(selection, edit);
          selection = documentCoordinates(schema, document.nodes).normalizeSelection(selection);

          if (selection) presence.set(id, selection);
          else presence.delete(id);
        }
    },
  });

  function active() {
    if (destroyed) throw new Error('Authority destroyed');
  }

  function rotate() {
    presence.clear();
    partitions?.clear();
    epoch++;
  }

  function project(principal: string) {
    const root = users.get(principal);

    if (!root) throw new Error('Not a document member');

    const projected = projectDocument(schema, document.nodes, {
      access: (node) => access.get(principal)?.get(node.key) ?? root,
    });

    const manifest: Manifest[] = [];
    const bodies = new Map<string, Body>();
    const outline: Frame['outline'] = [];

    function visit(value: ProjectedNode<N>, parent: string | null) {
      if (value.kind === 'protected') {
        manifest.push({ kind: 'protected', key: value.key, locked: value.locked, parent });

        return;
      }

      const node = value.node;
      const definition = schema.resolve(node);

      if (!definition.codec) throw new Error('Missing codec');
      manifest.push({ kind: 'visible', key: node.key, parent, access: value.access });
      bodies.set(
        node.key,
        bodySchema.parse({
          type: definition.name,
          data: definition.codec.encode(node),
          text: schema.text(node),
        }),
      );
      const title = options.title(node);

      if (title !== null) outline.push({ key: node.key, title });

      for (const child of value.children) visit(child, node.key);
    }

    for (const item of projected) visit(item, null);
    const tree = indexTree(schema, document.nodes);

    function readableRange(from: string, to: string) {
      const first = tree.order.findIndex((entry) => entry.node.key === from);
      const last = tree.order.findIndex((entry) => entry.node.key === to);

      return (
        first >= 0 &&
        last >= 0 &&
        tree.order
          .slice(Math.min(first, last), Math.max(first, last) + 1)
          .every((entry) => bodies.has(entry.node.key))
      );
    }

    return { manifest, bodies, outline, readableRange };
  }

  return {
    apply(steps: readonly Step<N>[]) {
      active();
      document.apply(steps);
    },
    setAccess(principal: string, key: string, value: NodeAccess) {
      active();

      if (!users.has(principal) || !indexTree(schema, document.nodes).byKey.has(key))
        throw new Error('Unknown permission target');
      const entries = access.get(principal) ?? new Map<string, NodeAccess>();

      if ((entries.get(key) ?? users.get(principal)) === value) return;
      entries.set(key, value);
      access.set(principal, entries);
      rotate();
    },
    connect(principal: string, send: (bytes: Uint8Array) => void) {
      active();

      if (!users.has(principal)) throw new Error('Not a document member');
      const session = `reader-${++sessionCount}`;

      let sequence = 0,
        sentEpoch = 0,
        signature = '',
        reset = true,
        closed = false;

      let presenceSequence = 0;

      let sentBodies = new Map<string, string>();
      let sentHeads = new Map<string, string[]>();
      const requested = new Set<string>();

      const writer = document.writer(session, (key) =>
        project(principal).manifest.some(
          (item) => item.key === key && item.kind === 'visible' && item.access === 'editable',
        ),
      );

      function close() {
        closed = true;
        presence.delete(session);
        requested.clear();
        sentBodies.clear();
        sentHeads.clear();
        signature = '';
        writer.close();
        connections.delete(close);
      }

      connections.add(close);

      function connected() {
        active();

        if (closed) throw new Error('Session closed');
      }

      return {
        session,
        submit(bytes: Uint8Array) {
          connected();
          let proposal: ProjectedProposal;

          try {
            proposal = decodeProposal(bytes);
          } catch {
            return encodeReceipt({ kind: 'invalid' });
          }

          return encodeReceipt(writer.submit(proposal));
        },
        requestAttachment(id: string) {
          connected();
          requested.add(id);
        },
        presence(bytes: Uint8Array) {
          connected();
          let packet: ProjectedPresence;

          try {
            packet = decodePresence(bytes);
          } catch {
            return false;
          }

          if (packet.session !== session || packet.sequence <= presenceSequence) return false;
          const selection = packet.selection;
          const view = project(principal);

          if (selection && !view.readableRange(selection.anchor.key, selection.head.key))
            return false;
          const mapped = writer.presence(packet);

          if (mapped.kind === 'rejected') return false;
          presenceSequence = packet.sequence;

          if (mapped.selection) presence.set(session, mapped.selection);
          else presence.delete(session);

          return true;
        },
        resync() {
          connected();
          reset = true;
        },
        flush() {
          connected();
          // Serialization happens at send time. Queued attachment requests hold
          // IDs only; content prepared under an old policy is never enqueued.
          const view = project(principal);

          const visibleComments = comments
            .filter(
              (item) =>
                view.readableRange(item.from, item.to) &&
                item.readKeys.every((key) => view.bodies.has(key)),
            )
            .map(({ id, from, to, text }) => ({ id, from, to, text }));

          const visiblePresence = [...presence].flatMap(([id, selection]) =>
            id !== session && view.readableRange(selection.anchor.key, selection.head.key)
              ? [{ session: id, selection }]
              : [],
          );

          const full = reset || sentEpoch !== epoch;
          const writes = writer.delivery(full ? null : sequence, epoch, view.bodies);

          const nextSignature = JSON.stringify({
            manifest: view.manifest,
            bodies: [...view.bodies],
            comments: visibleComments,
            outline: view.outline,
            presence: visiblePresence,
            receipts: writes.receipts,
          });

          if (
            !full &&
            nextSignature === signature &&
            requested.size === 0 &&
            writes.changes.length === 0
          )
            return false;
          const updates: Update[] = [];
          const nextBodies = new Map<string, string>();
          const nextHeads = new Map<string, string[]>();

          for (const [key, body] of view.bodies) {
            const bodySignature = JSON.stringify(body);
            nextBodies.set(key, bodySignature);

            if (options.delivery.kind === 'automerge') {
              const previousHeads = full ? undefined : sentHeads.get(key);
              const result = options.delivery.partitions.update(key, body, previousHeads);
              nextHeads.set(key, result.heads);

              if (result.update.kind === 'automerge' && result.update.bytes.length)
                updates.push(result.update);
            } else if (full || sentBodies.get(key) !== bodySignature)
              updates.push({ kind: 'json', key, body });
          }

          const responses: AttachmentResult[] = [...requested].map((id) => {
            const attachment = attachments.get(id);

            return attachment && view.bodies.has(attachment.key)
              ? { id, status: 'ready', key: attachment.key, body: attachment.body }
              : { id, status: 'unavailable' };
          });

          const frame: Frame = {
            session,
            epoch,
            sequence: sequence + 1,
            base: full ? null : sequence,
            manifest: view.manifest,
            updates,
            comments: visibleComments,
            outline: view.outline,
            presence: visiblePresence,
            attachments: responses,
            writes,
          };

          // Reserve the immutable view before handing control to the transport.
          // It may synchronously submit, flush, resync or close this connection.
          sequence = frame.sequence;
          sentEpoch = frame.epoch;
          signature = nextSignature;
          reset = false;
          sentBodies = nextBodies;
          sentHeads = nextHeads;
          requested.clear();
          writer.sent(frame.sequence, frame.epoch, view.bodies);

          try {
            send(encodeFrame(frame));
          } catch (error) {
            close();
            throw error;
          }

          return true;
        },
        close,
      };
    },
    destroy() {
      destroyed = true;

      for (const close of connections) close();
      partitions?.clear();
      presence.clear();
    },
  };
}
