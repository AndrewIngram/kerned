import { expect, test } from 'vitest';

import { supportsLayoutText } from '../owned-text-support.js';

test('printable ASCII and newline agree with the composer control-character policy', () => {
  const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join(
    '',
  );

  expect(supportsLayoutText(printable + '\n')).toBe(true);

  const controls = [...Array.from({ length: 32 }, (_, index) => index), 127].filter(
    (code) => code !== 10,
  );

  for (const code of controls) {
    expect(supportsLayoutText('text' + String.fromCharCode(code))).toBe(false);
    expect(supportsLayoutText('élan' + String.fromCharCode(code))).toBe(false);
  }
});

test.each([
  ['Café e\u0301lan', true],
  ['“Typography”—yes!', true],
  ['👨‍👩‍👧‍👦 🇬🇧 1️⃣', true],
  ['a\u200db', true],
  ['a\u2028b', false],
  ['a\u2029b', false],
  ['a\u202eb', true],
  ['مرحبا', true],
  ['שָׁלוֹם English 123', true],
  ['Ελληνικά Кириллица', true],
  ['中文 日本語 ㄅㄆㄇ', true],
  ['ひらがな カタカナ', false],
])('retains the Unicode support policy for %s', (text, accepted) => {
  expect(supportsLayoutText(text)).toBe(accepted);
});
