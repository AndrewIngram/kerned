import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';
import { z } from 'zod';

const manifest = z.object({
  source: z.string(),
  sourceSha256: z.string(),
  htmlSha256: z.string(),
  sourceTextVerified: z.literal(true),
});

test.each(['hayy-ibn-yaqzan', 'tashlikh', 'journey-to-the-west'])(
  '%s retains its pinned source and verified output',
  async (id) => {
    const directory = new URL('../apps/demo/public/samples/', import.meta.url);

    const data = manifest.parse(
      JSON.parse(await readFile(new URL(`${id}.json`, directory), 'utf8')),
    );

    const [source, html] = await Promise.all([
      readFile(new URL(data.source, directory)),
      readFile(new URL(`${id}.html`, directory)),
    ]);

    expect(createHash('sha256').update(source).digest('hex')).toBe(data.sourceSha256);
    expect(createHash('sha256').update(html).digest('hex')).toBe(data.htmlSha256);
  },
);
