import {
  containerDecorations,
  imageView,
  mentionView,
  documentPresentation,
  underlineView,
} from '@gprose/extension-document/browser';
import { documentInput } from '@gprose/extension-editing/browser';
import { tableView, tablePresentation } from '@gprose/extension-table/browser';

import { starterExtensions } from './index.js';

/** Browser composition shares the headless definitions and adds view capabilities. */
export function starterBrowserExtensions({
  imageDelay = 0,
  bodySize = 18,
}: { imageDelay?: number; bodySize?: number } = {}) {
  return [
    ...starterExtensions,
    imageView.configure({ delay: imageDelay }),
    documentInput,
    tableView,
    documentPresentation.configure({ bodySize }),
    tablePresentation,
    containerDecorations,
    underlineView,
    mentionView,
  ] as const;
}

export { starterHtmlParsers } from './html-parsers.js';
