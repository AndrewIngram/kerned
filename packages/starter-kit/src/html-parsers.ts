import { documentHtmlParsers } from '@gprose/extension-document/browser';
import { tableHtmlParsers } from '@gprose/extension-table/browser';

export const starterHtmlParsers = [...documentHtmlParsers, ...tableHtmlParsers] as const;
