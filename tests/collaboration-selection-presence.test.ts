import { expect, test } from 'vitest';

import { schema } from './experiments/collaboration/fixtures.js';
import { inspectWire } from './experiments/collaboration/protected/audit.js';
import { createProtectedAuthority } from './experiments/collaboration/protected/authority.js';
import { createOptimisticRecipient } from './experiments/collaboration/protected/optimistic.js';
import { decodePresence, encodePresence } from './experiments/collaboration/protected/wire.js';
import type { PresenceSelection } from './experiments/collaboration/protocol.js';

function caret(offset: number, key = 'one', association: -1 | 1 = 1): PresenceSelection {
  return { anchor: { key, offset, association }, head: { key, offset, association } };
}

const insert = (from: number, text: string, key = 'one') => ({ key, from, to: from, text });

function fixture(mode: 'json' | 'automerge') {
  const authority = createProtectedAuthority({
    schema,
    nodes: [
      { kind: 'note', id: 1, key: 'one', value: 'abcd' },
      { kind: 'note', id: 2, key: 'two', value: 'next' },
      {
        kind: 'group',
        id: 3,
        key: 'sealed',
        children: [{ kind: 'note', id: 4, key: 'PRIVATE_KEY', value: 'PRIVATE_TEXT' }],
      },
      { kind: 'note', id: 5, key: 'after', value: 'last' },
    ],
    mode,
    users: { alice: 'editable', bob: 'editable', owner: 'editable', reader: 'read-only' },
    comments: [],
    attachments: [],
    title: () => null,
  });

  authority.setAccess('alice', 'sealed', 'protected');
  authority.setAccess('bob', 'sealed', 'protected');
  const clients: ReturnType<typeof createOptimisticRecipient>[] = [];

  function connect(principal: string) {
    const frames: Uint8Array[] = [];
    const connection = authority.connect(principal, (bytes) => frames.push(bytes.slice()));
    const client = createOptimisticRecipient(connection.session);
    clients.push(client);

    function flush() {
      if (connection.flush()) client.receive(frames[frames.length - 1]);
    }

    function packet() {
      const bytes = client.presence();

      if (!bytes) throw new Error('No presence packet');

      return bytes;
    }

    function submit() {
      const bytes = client.request();

      if (!bytes) throw new Error('No edit request');

      return connection.submit(bytes);
    }

    flush();

    return { client, connection, frames, flush, packet, submit };
  }

  return {
    authority,
    connect,
    destroy() {
      for (const client of clients) client.destroy();
      authority.destroy();
    },
  };
}

for (const mode of ['json', 'automerge'] as const) {
  test(`${mode}: a caret at an optimistic deletion boundary maps to its associated confirmed edge`, () => {
    const f = fixture(mode),
      a = f.connect('alice'),
      b = f.connect('bob');

    a.client.edit({ key: 'one', from: 1, to: 3, text: '' });
    a.client.select(caret(1, 'one', -1));
    expect(decodePresence(a.packet()).selection).toEqual(caret(1, 'one', -1));
    a.client.select(caret(1));
    expect(decodePresence(a.packet()).selection).toEqual(caret(3));
    a.connection.presence(a.packet());
    b.flush();
    expect(b.client.remoteSelections()[0].selection).toEqual(caret(3));
    a.submit();
    a.flush();
    b.flush();
    expect(a.client.selection).toEqual(caret(1));
    expect(b.client.remoteSelections()[0].selection).toEqual(caret(1));
    f.destroy();
  });

  test(`${mode}: late acceptance maps a fresh caret after a discarded Unicode draft`, () => {
    const f = fixture(mode),
      a = f.connect('alice');

    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 4, text: '🇦🇧🇨🇩' }]);
    a.flush();
    a.client.edit({ key: 'one', from: 4, to: 8, text: 'X' });
    a.client.request();
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: '🇪' }]);
    a.flush();
    a.client.select(caret(10));
    a.client.edit(insert(10, '!'));
    expect(a.client.selection).toEqual(caret(11));
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: '🇫' }]);
    a.flush();
    expect(a.client.selection).toEqual(caret(13));
    a.submit();
    a.flush();
    expect(a.client.text('one')).toBe('🇫🇪🇦🇧X!');
    expect(a.client.selection).toEqual(caret(10));
    a.submit();
    a.flush();
    expect(a.client.selection).toEqual(caret(10));
    f.destroy();
  });

  test(`${mode}: local and remote caret affinity survives queued typing and confirmation`, () => {
    const f = fixture(mode),
      a = f.connect('alice'),
      b = f.connect('bob'),
      c = f.connect('owner');

    a.client.select(caret(1));
    b.client.select(caret(1));
    c.client.select(caret(1, 'one', -1));
    b.connection.presence(b.packet());
    c.connection.presence(c.packet());
    a.flush();
    a.client.edit(insert(1, 'X'));
    a.client.edit(insert(2, 'Y'));
    expect(a.client.selection).toEqual(caret(3));
    expect(a.client.remoteSelections()).toEqual([
      { session: b.connection.session, selection: caret(3) },
      { session: c.connection.session, selection: caret(1, 'one', -1) },
    ]);
    a.submit();
    a.flush();
    expect(a.client.selection).toEqual(caret(3));
    expect(a.client.remoteSelections()[0].selection).toEqual(caret(3));
    a.submit();
    a.flush();
    expect(a.client.selection).toEqual(caret(3));
    b.flush();
    expect(b.client.selection).toEqual(caret(3));
    f.destroy();
  });

  test(`${mode}: presence inside inserted text is hidden until confirmation, while boundaries map back`, () => {
    const f = fixture(mode),
      a = f.connect('alice'),
      b = f.connect('bob');

    a.client.select(caret(1));
    a.connection.presence(a.packet());
    b.flush();
    expect(b.client.remoteSelections()).toHaveLength(1);
    a.client.edit(insert(1, 'XYZ'));
    a.client.select(caret(4));
    expect(decodePresence(a.packet()).selection).toEqual(caret(1));
    a.client.select(caret(2));
    expect(decodePresence(a.packet()).selection).toBeNull();
    a.connection.presence(a.packet());
    b.flush();
    expect(b.client.remoteSelections()).toEqual([]);
    a.submit();
    a.flush();
    expect(a.client.selection).toEqual(caret(2));
    expect(a.connection.presence(a.packet())).toBe(true);
    b.flush();
    expect(b.client.remoteSelections()).toEqual([
      { session: a.connection.session, selection: caret(2) },
    ]);
    f.destroy();
  });

  test(`${mode}: backward cross-node selections retain orientation and defensive ownership`, () => {
    const f = fixture(mode),
      a = f.connect('alice'),
      b = f.connect('bob');

    const backwards = { anchor: caret(2, 'two').anchor, head: caret(1).head };
    a.client.select(backwards);
    backwards.head.offset = 0;
    a.client.edit(insert(0, 'X'));
    expect(a.client.selection).toEqual({ anchor: caret(2, 'two').anchor, head: caret(2).head });
    const copy = a.client.selection;

    if (copy) copy.head.offset = 0;
    expect(a.client.selection?.head.offset).toBe(2);
    expect(a.connection.presence(a.packet())).toBe(true);
    b.flush();
    expect(b.client.remoteSelections()[0].selection).toEqual({
      anchor: caret(2, 'two').anchor,
      head: caret(1).head,
    });
    a.submit();
    a.flush();
    b.flush();
    expect(b.client.remoteSelections()[0].selection).toEqual(a.client.selection);
    f.destroy();
  });

  test(`${mode}: stale-view presence is mapped, while reordered packets and wrong sessions are rejected`, () => {
    const f = fixture(mode),
      a = f.connect('alice'),
      b = f.connect('bob');

    a.client.select(caret(2));
    const old = a.packet();
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'Q' }]);
    expect(a.connection.presence(old)).toBe(true);
    b.flush();
    expect(b.client.remoteSelections()[0].selection).toEqual(caret(3));
    expect(a.connection.presence(old)).toBe(false);
    expect(b.connection.presence(old)).toBe(false);
    a.client.select(null);
    expect(a.connection.presence(a.packet())).toBe(true);
    expect(a.connection.presence(old)).toBe(false);
    b.flush();
    expect(b.client.remoteSelections()).toEqual([]);
    expect(a.connection.presence(new TextEncoder().encode('{bad'))).toBe(false);
    f.destroy();
  });

  test(`${mode}: conflicts clear affected local selections while unrelated selections and fresh typing survive`, () => {
    const f = fixture(mode),
      a = f.connect('alice'),
      b = f.connect('bob');

    a.client.edit({ key: 'one', from: 1, to: 3, text: 'X' });
    a.client.request();
    a.client.select(caret(2));
    b.client.select(caret(1, 'two'));
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 1, to: 3, text: 'R' }]);
    a.flush();
    b.flush();
    expect(a.client.selection).toBeNull();
    expect(b.client.selection).toEqual(caret(1, 'two'));
    a.client.select(caret(3));
    a.client.edit(insert(3, '!'));
    a.submit();
    a.flush();
    expect(a.client.selection).toEqual(caret(4));
    a.submit();
    a.flush();
    expect(a.client.selection).toEqual(caret(4));
    f.destroy();
  });

  test(`${mode}: protected ranges are never published and access rotation clears stale presence`, () => {
    const f = fixture(mode),
      a = f.connect('alice'),
      b = f.connect('bob'),
      owner = f.connect('owner');

    const crossing = { anchor: caret(0).anchor, head: caret(1, 'after').head };
    expect(() => a.client.select(crossing)).toThrow('Invalid selection');
    owner.client.select(crossing);
    expect(owner.connection.presence(owner.packet())).toBe(true);
    b.flush();
    expect(b.client.remoteSelections()).toEqual([]);
    a.client.select(caret(1));
    const packet = a.packet();
    a.connection.presence(packet);
    b.flush();
    expect(b.client.remoteSelections()).toHaveLength(1);
    f.authority.setAccess('alice', 'one', 'protected');
    expect(a.connection.presence(packet)).toBe(false);
    a.flush();
    b.flush();
    expect(a.client.selection).toBeNull();
    expect(b.client.remoteSelections()).toEqual([]);
    expect(inspectWire(b.frames)).not.toContain('PRIVATE');
    f.authority.setAccess('alice', 'one', 'editable');
    a.flush();
    expect(
      a.connection.presence(encodePresence({ ...decodePresence(packet), sequence: 999 })),
    ).toBe(false);
    a.client.select(caret(1));
    expect(a.connection.presence(a.packet())).toBe(true);
    b.flush();
    expect(b.client.remoteSelections()).toHaveLength(1);
    a.connection.close();
    b.flush();
    expect(b.client.remoteSelections()).toEqual([]);
    f.destroy();
  });

  test(`${mode}: invalid Unicode endpoints are rejected and deleted remote endpoints disappear`, () => {
    const f = fixture(mode),
      a = f.connect('alice'),
      b = f.connect('bob');

    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 4, text: '😀a\u0301مرحبا' }]);
    a.flush();
    b.flush();
    expect(() => a.client.select(caret(1))).toThrow('Invalid selection');
    expect(() => a.client.select(caret(3))).toThrow('Invalid selection');
    a.client.select(caret(2));
    const packet = decodePresence(a.packet());
    expect(a.connection.presence(encodePresence({ ...packet, selection: caret(1) }))).toBe(false);
    expect(
      a.connection.presence(
        encodePresence({ ...packet, sequence: packet.sequence + 1, selection: caret(2) }),
      ),
    ).toBe(true);
    b.flush();
    b.client.edit({ key: 'one', from: 0, to: 4, text: 'X' });
    expect(b.client.remoteSelections()).toEqual([]);
    b.submit();
    b.flush();
    a.flush();
    expect(a.client.selection).toBeNull();
    expect(b.client.remoteSelections()).toEqual([]);
    f.destroy();
  });

  test(`${mode}: gap and full resync clear local selection, stale frames cannot revive it`, () => {
    const f = fixture(mode),
      a = f.connect('alice');

    a.client.select(caret(1));
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'Q' }]);
    a.connection.flush();
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'R' }]);
    a.connection.flush();
    expect(a.client.receive(a.frames[2])).toBe(false);
    expect(a.client.selection).toBeNull();
    expect(a.client.presence()).toBeNull();
    expect(a.client.remoteSelections()).toEqual([]);
    a.connection.resync();
    a.flush();
    expect(a.client.selection).toBeNull();
    expect(a.client.receive(a.frames[1])).toBe(false);
    a.client.select(caret(3));
    a.connection.resync();
    a.flush();
    expect(a.client.selection).toBeNull();
    f.destroy();
  });

  test(`${mode}: read-only participants can share selections without gaining write access`, () => {
    const f = fixture(mode),
      a = f.connect('reader'),
      b = f.connect('bob');

    a.client.select(caret(2));
    expect(a.connection.presence(a.packet())).toBe(true);
    expect(() => a.client.edit(insert(2, 'X'))).toThrow('Target not editable');
    b.flush();
    expect(b.client.remoteSelections()[0].selection).toEqual(caret(2));
    f.destroy();
  });
}
