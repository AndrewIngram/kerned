import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source entry points still use bundler-style extensionless paths until package
// delivery. Resolve those paths only; Node owns loading and rejects CSS or DOM imports.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL) {
    const base = new URL(specifier, context.parentURL);

    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      const target = new URL(base.href + suffix);

      if (existsSync(fileURLToPath(target))) return nextResolve(target.href, context);
    }
  }

  return nextResolve(specifier, context);
}
