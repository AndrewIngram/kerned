import { documentFormatting } from '@kerned/extension-document';
import { documentEditing, documentStructure } from '@kerned/extension-editing';
import { localHistory } from '@kerned/extension-history';
import { tableEditing } from '@kerned/extension-table';

import { starterDefinitions } from './definitions.js';
import { starterSerialization } from './serializers.js';

export const starterExtensions = [
  ...starterDefinitions,
  starterSerialization,
  localHistory,
  documentFormatting,
  documentStructure,
  tableEditing,
  documentEditing,
] as const;

export { starterDefinitions } from './definitions.js';

export { starterSerializers } from './serializers.js';
