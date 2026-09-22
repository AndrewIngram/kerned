import { documentFormatting } from '@gprose/extension-document';
import { documentEditing, documentStructure } from '@gprose/extension-editing';
import { localHistory } from '@gprose/extension-history';
import { tableEditing } from '@gprose/extension-table';

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
