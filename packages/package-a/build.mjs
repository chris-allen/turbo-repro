// Stand-in for a one-shot package build (e.g. `tsc`). Non-persistent,
// cache disabled, so `turbo watch` re-runs it whenever it decides this
// package is affected. It emits to a gitignored `dist/` and exits.
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync(new URL('./dist', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/index.js', import.meta.url), 'export const a = "a";\n');
console.log('[package-a] built', new Date().toISOString());
