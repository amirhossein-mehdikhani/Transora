import { registerHooks } from 'node:module';
import fs from 'node:fs';
// Match TypeScript/Vite's extensionless source imports when tests execute in Node.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    for (const suffix of ['.ts', '/index.ts']) {
      const url = new URL(specifier + suffix, context.parentURL);
      if (fs.existsSync(url)) return next(url.href, context);
    }
  }
  return next(specifier, context);
}});
