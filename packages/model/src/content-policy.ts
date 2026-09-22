import type { ChildContent, SchemaDefinition } from './definitions.js';

/** Named groups select installed definitions without making optional kit members dependencies. */
export function childPolicy(content: ChildContent, definitions: readonly SchemaDefinition[]) {
  function names(explicit?: readonly string[], groups?: readonly string[]) {
    if (!explicit && !groups) return undefined;
    const selected = new Set(explicit);

    for (const definition of definitions)
      if (
        definition.category === 'node' &&
        definition.spec.groups?.some((group) => groups?.includes(group))
      )
        selected.add(definition.name);

    return [...selected];
  }

  return {
    allowed: names(content.allowed, content.allowedGroups),
    first: names(content.first, content.firstGroups),
  };
}
