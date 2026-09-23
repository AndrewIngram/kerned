import {
  paragraph,
  heading,
  image,
  quote,
  list,
  listItem,
  formattingDefinitions,
  mentionDefinition,
} from '@kerned/extension-document';
import { table, tableCell } from '@kerned/extension-table';

export const starterDefinitions = [
  paragraph,
  heading,
  image,
  table,
  tableCell,
  quote,
  list,
  listItem,
  ...formattingDefinitions,
  mentionDefinition,
] as const;
