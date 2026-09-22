import { expect, test } from 'vitest';

import { checkContainers } from '../apps/demo/src/editor-container-checks.js';
import { checkExtensions } from '../apps/demo/src/editor-extension-checks.js';
import { checkSelections } from '../apps/demo/src/editor-selection-checks.js';
import { checkTransactions } from '../apps/demo/src/editor-transaction-checks.js';

test.each([
  ['containers', checkContainers],
  ['extensions', checkExtensions],
  ['selections', checkSelections],
  ['transactions', checkTransactions],
] as const)('retained %s contracts', (_name, check) => {
  expect(check().assertions).toBeGreaterThan(0);
});
