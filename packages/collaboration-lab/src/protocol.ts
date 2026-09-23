import { z } from 'zod';

const integer = z.number().int().nonnegative();

const identity = z.string().min(1);

const endpoint = z.object({
  key: identity,
  offset: integer,
  association: z.union([z.literal(-1), z.literal(1)]),
});

const selection = z.object({ anchor: endpoint, head: endpoint });

export const editSchema = z
  .object({
    key: identity,
    from: integer,
    to: integer,
    text: z.string(),
    expected: z.string(),
    run: z.object({ id: identity, offset: integer }).optional(),
  })
  .refine((value) => value.to >= value.from, 'Invalid edit range');

const proposal = z.object({
  generation: identity,
  sequence: integer.positive(),
  version: integer,
  edit: editSchema,
});

const commit = z.object({
  generation: identity,
  version: integer.positive(),
  session: identity,
  sequence: integer.positive(),
  edit: editSchema,
});

const presence = z.object({
  generation: identity,
  version: integer,
  sequence: integer.positive(),
  selection: selection.nullable(),
});

const remotePresence = presence.extend({ session: identity });

const presenceSnapshot = z.object({
  generation: identity,
  recipient: identity,
  sequence: integer.positive(),
  peers: z.array(remotePresence),
});

export type PresenceSnapshot = Readonly<z.infer<typeof presenceSnapshot>>;

export const parsePresenceSnapshot = presenceSnapshot.parse.bind(presenceSnapshot);

export type Edit = Readonly<z.infer<typeof editSchema>>;

export type Endpoint = Readonly<z.infer<typeof endpoint>>;

export type PresenceSelection = Readonly<z.infer<typeof selection>>;

export type Proposal = Readonly<z.infer<typeof proposal>>;

export type Commit = Readonly<z.infer<typeof commit>>;

export type Presence = Readonly<z.infer<typeof presence>>;

export type RemotePresence = Readonly<z.infer<typeof remotePresence>>;

export const parseProposal = proposal.parse.bind(proposal);

export const parseCommit = commit.parse.bind(commit);

export const parsePresence = presence.parse.bind(presence);

export const parseRemotePresence = remotePresence.parse.bind(remotePresence);

export function sameEdit(left: Edit, right: Edit): boolean {
  return (
    left.key === right.key &&
    left.from === right.from &&
    left.to === right.to &&
    left.text === right.text &&
    left.expected === right.expected &&
    left.run?.id === right.run?.id &&
    left.run?.offset === right.run?.offset
  );
}

/** Authority wins equal-position insertions. Ambiguous overlap is a conflict,
 * not permission to overwrite concurrently inserted/replaced content. */
export function rebase(edit: Edit, over: Edit, afterEqualInsertion = true): Edit | null {
  if (edit.key !== over.key) return edit;
  const delta = over.text.length - (over.to - over.from);

  if (edit.from === edit.to && over.from === over.to && edit.from === over.from) {
    const continuing = (edit.run?.offset ?? 0) > 0;
    const overContinuing = (over.run?.offset ?? 0) > 0;
    const after = continuing === overContinuing ? afterEqualInsertion : overContinuing;

    return after ? { ...edit, from: edit.from + delta, to: edit.to + delta } : edit;
  }

  if (edit.to <= over.from) return edit;

  if (edit.from >= over.to) return { ...edit, from: edit.from + delta, to: edit.to + delta };

  return null;
}

function mapEndpoint(point: Endpoint, edit: Edit): Endpoint | null {
  if (point.key !== edit.key || point.offset < edit.from) return point;

  if (point.offset > edit.from && point.offset < edit.to) return null;

  if (point.offset > edit.to)
    return { ...point, offset: point.offset + edit.text.length - (edit.to - edit.from) };

  return { ...point, offset: edit.from + (point.association === 1 ? edit.text.length : 0) };
}

export function mapSelection(
  value: PresenceSelection | null,
  edit: Edit,
): PresenceSelection | null {
  if (!value) return null;

  const anchor = mapEndpoint(value.anchor, edit),
    head = mapEndpoint(value.head, edit);

  return anchor && head ? { anchor, head } : null;
}
