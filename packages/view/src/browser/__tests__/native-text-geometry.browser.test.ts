import { expect, test } from 'vitest';

import { nativeTextCaret } from '../native-text-geometry.js';

test('native textarea coordinates respect UTF-16 offsets, lines, padding and scrolling without changing input state', async ({
  onTestFinished,
}) => {
  const input = document.createElement('textarea');
  input.style.cssText =
    'position:fixed;left:40px;top:50px;box-sizing:border-box;width:240px;height:70px;border:2px solid;padding:6px;font:20px/30px monospace;';
  input.value = 'abcd\nxy\n';
  document.body.append(input);
  onTestFinished(() => input.remove());
  input.focus();
  input.setSelectionRange(1, 3, 'backward');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  input.scrollTop = 0;
  const children = document.body.childElementCount;
  const start = nativeTextCaret(input, 0);
  const second = nativeTextCaret(input, 2);
  const nextLine = nativeTextCaret(input, 5);
  const lastLine = nativeTextCaret(input, input.value.length);

  if (!start || !second || !nextLine || !lastLine) throw new Error('Missing native caret');
  expect(start.left).toBeCloseTo(input.getBoundingClientRect().left + 8, 0);
  const measure = document.createElement('canvas').getContext('2d');

  if (!measure) throw new Error('Missing text measurement');
  measure.font = '20px monospace';
  expect(second.left - start.left).toBeCloseTo(measure.measureText('ab').width, 0);
  expect(nextLine.top - start.top).toBeCloseTo(30, 0);
  expect(lastLine.top - start.top).toBeCloseTo(60, 0);
  input.scrollTop = 20;
  expect(nativeTextCaret(input, 5)?.top).toBeCloseTo(nextLine.top - input.scrollTop, 0);
  expect(input.value).toBe('abcd\nxy\n');
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(3);
  expect(input.selectionDirection).toBe('backward');
  expect(document.activeElement).toBe(input);
  expect(document.body.childElementCount).toBe(children);
  input.value = 'a😀b';
  input.scrollTop = 0;
  const afterEmoji = nativeTextCaret(input, 3);
  expect(afterEmoji?.left).toBeCloseTo(
    (nativeTextCaret(input, 0)?.left ?? 0) + measure.measureText('a😀').width,
    0,
  );
  input.value = '';
  expect(nativeTextCaret(input, 0)?.height).toBeGreaterThan(0);
  expect(nativeTextCaret(input, 1)).toBeNull();
  expect(nativeTextCaret(input, -1)).toBeNull();
  input.remove();
  expect(nativeTextCaret(input, 0)).toBeNull();
});

test('native geometry follows wrapped text, scaled controls and inline DOM formatting', ({
  onTestFinished,
}) => {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:30px;top:30px;transform:scale(1.5);transform-origin:top left;';
  const input = document.createElement('textarea');
  input.style.cssText =
    'width:100px;height:180px;box-sizing:border-box;padding:0;border:0;font:20px/30px monospace;';
  input.value = 'xxxxxxxxxxxxxxxx';
  host.append(input);
  const text = document.createElement('p');
  text.style.cssText = 'white-space:pre-wrap;font:20px/30px monospace;';
  const first = document.createElement('span');
  first.textContent = 'Hi ';
  const bold = document.createElement('strong');
  bold.textContent = 'there';
  text.append(first, bold);
  host.append(text);
  document.body.append(host);
  onTestFinished(() => host.remove());
  const start = nativeTextCaret(input, 0);
  const wrapped = nativeTextCaret(input, 9);

  if (!start || !wrapped) throw new Error('Missing wrapped caret');
  expect(wrapped.top - start.top).toBeCloseTo(45, 0);
  expect(wrapped.left).toBeGreaterThan(start.left);
  const point = nativeTextCaret(text, 5);
  const node = bold.firstChild;

  if (!point || !node) throw new Error('Missing DOM caret');
  const range = document.createRange();
  range.setStart(node, 2);
  range.collapse(true);
  const actual = range.getBoundingClientRect();
  expect(point.left).toBeCloseTo(actual.left, 1);
  expect(point.top).toBeCloseTo(actual.top, 1);
  expect(point.height).toBeCloseTo(actual.height, 1);
});
