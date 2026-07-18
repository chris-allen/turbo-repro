// A stand-in for a bundler-backed dev server (Next.js/Turbopack, Vite, ...).
//
// The only behaviour that matters for this reproduction: when a route is
// "compiled" (here: on every HTTP request), the bundler writes a large burst
// of build artifacts into a GITIGNORED output directory (`.cache/`, standing in
// for `.next/`). Nothing tracked by git changes.
//
// `turbo watch` still receives the raw filesystem events for that burst. When
// the burst is large enough it overflows turbo's file-event channel
// ("WARNING lagged behind N processing file watching events"), which forces a
// full package rediscovery and re-runs EVERY `dev` task in the graph, even
// though no source file changed.
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 3000);
// Total files and directories written per "compile". Bigger = more reliable
// overflow. Tune down to find your machine's threshold.
const FILES = Number(process.env.BARRAGE_FILES || 30000);
const DIRS = Number(process.env.BARRAGE_DIRS || 300);

const CACHE_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '.cache');

function barrage() {
  // Clear + rewrite, mimicking a fresh compile. The rm also contributes a
  // burst of delete events.
  rmSync(CACHE_DIR, { recursive: true, force: true });
  const perDir = Math.ceil(FILES / DIRS);
  let n = 0;
  for (let d = 0; d < DIRS; d++) {
    const dir = join(CACHE_DIR, 'chunks', String(d));
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < perDir; f++) {
      writeFileSync(join(dir, `chunk-${f}.js`), '// ' + 'x'.repeat(128) + '\n');
      n++;
    }
  }
  return n;
}

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.statusCode = 204;
    res.end();
    return;
  }
  const start = Date.now();
  const n = barrage();
  const msg = `[web] compiled ${req.url} -> wrote ${n} files into .cache/ in ${Date.now() - start}ms`;
  console.log(msg);
  res.end(msg + '\n');
});

server.listen(PORT, () => {
  console.log(`[web] dev server ready on http://localhost:${PORT}`);
  console.log('[web] hit it in a browser or with `curl localhost:' + PORT + '` to trigger a build barrage');
});
