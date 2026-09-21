import { localHistory } from '../history';
import { starterDefinitions } from '../starter-definitions';
import { starterEditing } from './commands';
import { starterFormatting } from './formatting';
import { starterStructure } from './structure';
import { starterTables } from './tables';

export const starterExtensions = [
  ...starterDefinitions,
  localHistory,
  starterFormatting,
  starterStructure,
  starterTables,
  starterEditing,
] as const;
