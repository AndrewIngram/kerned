import type { Color } from 'canvaskit-wasm';

const defaultColor = '#252a23';

/** Resolve standalone CSS colors once per value, outside the canvas paint loop. */
export function createTextColors(document: Document) {
  const values = new Map<string, { css: string; canvas: Color }>();
  let context: CanvasRenderingContext2D | null = null;

  return (value = defaultColor) => {
    const cached = values.get(value);

    if (cached) return cached;

    if (!context) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      context = canvas.getContext('2d', { willReadFrequently: true });

      if (!context) throw new Error('Text color resolution requires a 2D canvas');
    }

    if (/\b(?:var|currentcolor|inherit|initial|unset|revert)\b/i.test(value))
      throw new Error(`Text color must be a standalone CSS color: ${value}`);
    context.fillStyle = '#010203';
    context.fillStyle = value;
    const parsed = context.fillStyle;
    context.fillStyle = '#040506';
    context.fillStyle = value;

    if (context.fillStyle !== parsed) throw new Error(`Invalid text color: ${value}`);
    context.clearRect(0, 0, 1, 1);
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;

    const color = {
      css: `rgba(${r}, ${g}, ${b}, ${a / 255})`,
      canvas: new Float32Array([r / 255, g / 255, b / 255, a / 255]),
    };

    values.set(value, color);
    const oldest = values.keys().next();

    if (values.size > 128 && !oldest.done) values.delete(oldest.value);

    return color;
  };
}
