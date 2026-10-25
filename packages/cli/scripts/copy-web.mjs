// Bundle the built web app into the CLI so `envx ui` can serve it offline.
import { cp, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../web/dist', import.meta.url));
const dest = fileURLToPath(new URL('../web', import.meta.url));

try {
  await access(src);
} catch {
  console.warn('copy-web: packages/web/dist not found; build @envx/web first for `envx ui`.');
  process.exit(0);
}
await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });
console.log('copy-web: bundled web app into packages/cli/web');
