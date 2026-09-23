import {
  containerDecorations,
  imageView,
  mentionView,
  documentPresentation,
  underlineView,
} from '@kerned/extension-document/browser';
import { documentInput } from '@kerned/extension-editing/browser';
import { tableView, tablePresentation } from '@kerned/extension-table/browser';

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
