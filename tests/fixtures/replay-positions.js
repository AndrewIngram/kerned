import {indexTree, boundaries} from '../../src/editor/index.ts';

// Deliberately slow reference interpreter. It knows nothing about summaries or chunks.
export function replayRange(schema, editor, range) {
  const checkpoint = editor.positions.checkpoint(), definitions = new Map(checkpoint.definitions.map(d => [d.id, d.maps]));
  const pending = [], last = new Map();

  for (const event of checkpoint.events) if (event.revision > range.start.revision) for (const op of event.operations) {
    const at = last.get(op.id), previous = at === undefined ? null : pending[at];

    if (previous && previous.inverse !== op.inverse) {pending[at] = null; last.delete(op.id);}
    else {last.set(op.id, pending.length); pending.push(op);}
  }

  function invert(map) {
    switch (map.kind) {
      case 'replace': return {...map, to: map.from + map.inserted, inserted: map.to - map.from};
      case 'split': return {...map, kind: 'join'};
      case 'join': return {...map, kind: 'split'};
      case 'insert': return {...map, kind: 'remove'};
      case 'remove': return {...map, kind: 'insert'};
    }
  }

  const maps = pending.flatMap(op => !op ? [] : op.inverse ? [...definitions.get(op.id)].reverse().map(invert) : definitions.get(op.id));
  let start = {key: range.start.key, offset: range.start.offset}, end = {key: range.end.key, offset: range.end.offset};
  const empty = start.key === end.key && start.offset === end.offset;

  function apply(point, map, bias, role) {
    if (!point) return null;

    if (map.kind === 'remove' && map.keys.includes(point.key)) {
      const f = map.fallbacks?.find(f => f.key === point.key);

      return role === 'start' ? f?.after ?? f?.before ?? null : f?.before ?? f?.after ?? null;
    }

    if (map.kind === 'split' && point.key === map.key && (point.offset > map.at || point.offset === map.at && bias === 1)) return {key: map.rightKey, offset: point.offset - map.at};

    if (map.kind === 'join' && point.key === map.rightKey) return {key: map.key, offset: point.offset + map.at};

    if (map.kind === 'replace' && point.key === map.key) return {key: point.key, offset: point.offset < map.from ? point.offset : point.offset > map.to ? point.offset + map.inserted - map.to + map.from : map.from + (bias === 1 ? map.inserted : 0)};

    return point;
  }

  for (const map of maps) {
    if (!empty && start && end && start.key === end.key && map.kind === 'replace' && map.key === start.key && map.to > map.from && map.from <= start.offset && map.to >= end.offset) return {status: 'deleted'};
    start = apply(start, map, range.start.association, 'start'); end = apply(end, map, range.end.association, 'end');
  }

  if (!start || !end) return {status: 'deleted'};
  const texts = indexTree(schema, editor.state.nodes).order.map(e => e.node).filter(n => schema.text(n) !== null);
  const first = texts.findIndex(n => n.key === start.key), lastIndex = texts.findIndex(n => n.key === end.key);

  if (first < 0 || lastIndex < 0) return {status: 'deleted'};

  function snap(node, point, bias) {const stops = boundaries(schema.text(node));

 return bias === 1 ? stops.find(at => at >= point.offset) : stops.reverse().find(at => at <= point.offset);}

  start.offset = snap(texts[first], start, range.start.association); end.offset = snap(texts[lastIndex], end, range.end.association);

  if (first > lastIndex || first === lastIndex && (start.offset > end.offset || !empty && start.offset === end.offset)) return {status: 'deleted'};

  return {status: 'resolved', ranges: texts.slice(first, lastIndex + 1).map((node, i, nodes) => ({id: node.id, from: i === 0 ? start.offset : 0, to: i === nodes.length - 1 ? end.offset : schema.text(node).length}))};
}
