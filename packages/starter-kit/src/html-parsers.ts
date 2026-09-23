import { documentHtmlParsers } from '@kerned/extension-document/browser';
import { tableHtmlParsers } from '@kerned/extension-table/browser';

export const starterHtmlParsers = [...documentHtmlParsers, ...tableHtmlParsers] as const;
