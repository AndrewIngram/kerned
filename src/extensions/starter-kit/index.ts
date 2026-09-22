import { localHistory } from '@gprose/extension-history';

import { starterDefinitions } from '../starter-definitions';
import { starterSerialization } from '../static-serializers';
import { starterEditing } from './commands';
import { starterFormatting } from './formatting';
import { starterStructure } from './structure';
import { starterTables } from './tables';

export const starterExtensions = [
  ...starterDefinitions,
  starterSerialization,
  localHistory,
  starterFormatting,
  starterStructure,
  starterTables,
  starterEditing,
] as const;
