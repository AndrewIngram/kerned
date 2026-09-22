import {
  paragraph,
  heading,
  image,
  quote,
  list,
  listItem,
  formattingDefinitions,
  mentionDefinition,
} from '@gprose/extension-document';
import { table, tableCell } from '@gprose/extension-table';

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
