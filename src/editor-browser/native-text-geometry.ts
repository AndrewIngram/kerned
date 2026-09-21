/** Read a native text caret in client coordinates without moving browser selection. */
export function nativeTextCaret(element: HTMLElement, offset: number): DOMRect | null {
  if (!element.isConnected || !Number.isSafeInteger(offset) || offset < 0) return null;

  if (element instanceof HTMLTextAreaElement) return textareaCaret(element, offset);

  if (offset > (element.textContent?.length ?? 0)) return null;

  return textCaret(element, offset);
}

/** Scroll only the supplied local containers, from inner to outer, without focusing text. */
export function revealNativeText(
  element: HTMLElement,
  offset: number,
  scrollports: readonly HTMLElement[],
) {
  for (const port of scrollports) {
    const caret = nativeTextCaret(element, offset);

    if (!caret || !port.offsetWidth || !port.offsetHeight) return;
    const bounds = port.getBoundingClientRect();
    const scaleX = bounds.width / port.offsetWidth;
    const scaleY = bounds.height / port.offsetHeight;

    if (!scaleX || !scaleY) return;
    const left = bounds.left + port.clientLeft * scaleX;
    const top = bounds.top + port.clientTop * scaleY;
    const right = left + port.clientWidth * scaleX;
    const bottom = top + port.clientHeight * scaleY;
    // Native scroll offsets can round fractional assignments toward zero.
    port.scrollLeft +=
      caret.left < left
        ? Math.floor((caret.left - left) / scaleX)
        : Math.ceil(Math.max(0, caret.right - right) / scaleX);
    port.scrollTop +=
      caret.top < top
        ? Math.floor((caret.top - top) / scaleY)
        : Math.ceil(Math.max(0, caret.bottom - bottom) / scaleY);
  }
}

function textCaret(element: HTMLElement, offset: number): DOMRect | null {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;

    if (remaining > length) {
      remaining -= length;
      continue;
    }

    const range = document.createRange();
    range.setStart(node, remaining);
    range.collapse(true);
    const afterNewline = remaining > 0 && node.textContent?.[remaining - 1] === '\n';

    if (afterNewline && remaining === length) {
      remaining = 0;
      continue;
    }

    // Firefox can report the preceding line for a collapsed range after a newline.
    // The next character provides the downstream line without changing DOM selection.
    if (afterNewline) range.setEnd(node, remaining + 1);
    const caret = Array.from(range.getClientRects()).find((rect) => rect.height > 0);

    if (caret) return new DOMRect(caret.left, caret.top, 1, caret.height);

    // Some engines omit collapsed rectangles at a text-node boundary.
    if (remaining < length) {
      range.setEnd(node, remaining + 1);
      const next = range.getBoundingClientRect();

      if (next.height) return new DOMRect(next.left, next.top, 1, next.height);
    } else if (remaining > 0) {
      range.setStart(node, remaining - 1);
      range.setEnd(node, remaining);
      const previous = range.getBoundingClientRect();

      if (previous.height) return new DOMRect(previous.right, previous.top, 1, previous.height);
    }

    return null;
  }

  return null;
}

const textProperties = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'tab-size',
  'direction',
  'writing-mode',
  'text-orientation',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
] as const;

function textareaCaret(input: HTMLTextAreaElement, offset: number): DOMRect | null {
  if (offset > input.value.length) return null;
  const document = input.ownerDocument;
  const window = document.defaultView;

  if (!window || !input.offsetWidth || !input.offsetHeight) return null;
  const style = window.getComputedStyle(input);
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.cssText =
    'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;margin:0;border:0;box-sizing:border-box;height:auto;';

  for (const property of textProperties)
    mirror.style.setProperty(property, style.getPropertyValue(property));
  mirror.style.width = `${input.clientWidth}px`;
  mirror.style.whiteSpace = input.wrap === 'off' ? 'pre' : 'pre-wrap';
  mirror.style.overflowWrap = input.wrap === 'off' ? 'normal' : 'break-word';
  // A zero-width final character gives empty text and a trailing newline a line box.
  mirror.textContent = input.value + '\u200b';
  document.body.append(mirror);

  try {
    const caret = textCaret(mirror, offset);

    if (!caret) return null;
    const bounds = input.getBoundingClientRect();
    const scaleX = bounds.width / input.offsetWidth;
    const scaleY = bounds.height / input.offsetHeight;

    return new DOMRect(
      bounds.left + (input.clientLeft + caret.left - input.scrollLeft) * scaleX,
      bounds.top + (input.clientTop + caret.top - input.scrollTop) * scaleY,
      scaleX,
      caret.height * scaleY,
    );
  } finally {
    mirror.remove();
  }
}
