import { expect, test } from 'vitest';

import { checkContainers } from '../src/editor-container-checks';
import { checkExtensions } from '../src/editor-extension-checks';
import { checkSelections } from '../src/editor-selection-checks';
import { checkTransactions } from '../src/editor-transaction-checks';

test.each([
  ['containers', checkContainers],
  ['extensions', checkExtensions],
  ['selections', checkSelections],
  ['transactions', checkTransactions],
] as const)('retained %s contracts', (_name, check) => {
  expect(check().assertions).toBeGreaterThan(0);
});
