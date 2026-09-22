import { documentFormatting } from '@gprose/extension-document';
import { localHistory } from '@gprose/extension-history';
import { tableEditing } from '@gprose/extension-table';

import { starterDefinitions } from '../starter-definitions';
import { starterSerialization } from '../static-serializers';
import { starterEditing } from './commands';
import { starterStructure } from './structure';

export const starterExtensions = [
  ...starterDefinitions,
  starterSerialization,
  localHistory,
  documentFormatting,
  starterStructure,
  tableEditing,
  starterEditing,
] as const;
