// Same as package-a, but depends on package-a so the `^dev` chain has depth.
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync(new URL('./dist', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/index.js', import.meta.url), 'export const b = "b";\n');
console.log('[package-b] built', new Date().toISOString());
