# turbo-watcher-overflow

Minimal reproduction: **`turbo watch` re-runs every `dev` task in the graph when a
dev server writes a large burst of files into a *gitignored* directory.** No source
file changes, yet the whole dependency graph rebuilds.

Reproduced on **turbo 2.10.5** (latest at time of writing), pnpm 10.15.1, Node 22, Linux.

## The setup

A tiny pnpm + Turborepo workspace, mirroring a common dev topology:

```
apps/web          persistent dev server  (dev: node dev.mjs, persistent: true)
packages/package-a one-shot build         (dev: node build.mjs, cache: false)
packages/package-b one-shot build         (dev: node build.mjs, cache: false, deps package-a)
```

`web` depends on `package-a` + `package-b`. The root `dev` task is
`{ dependsOn: ["^dev"], cache: false }` and everything is orchestrated with
`turbo watch dev` — the same shape as a Next.js/Turbopack or Vite monorepo where
apps run a persistent server and packages run `tsc`.

`apps/web/dev.mjs` is a stand-in for a bundler. The only behaviour that matters:
**on every HTTP request it writes ~30,000 files into `apps/web/.cache/`** (which is
gitignored), simulating a bundler writing build artifacts into `.next/` on a route
compile. Nothing tracked by git ever changes.

## Steps to reproduce

```bash
pnpm install
pnpm dev                       # runs `turbo watch dev --continue`
# wait for: [web] dev server ready on http://localhost:3000
```

Then, in another terminal, hit the app once:

```bash
curl localhost:3000
```

### Expected

Nothing re-runs. Only gitignored files under `apps/web/.cache/` were written, and
nothing depends on `web` anyway. The dev server handles its own output.

### Actual

`package-a` and `package-b` `dev` tasks re-run (you'll see `[package-a] built` /
`[package-b] built` print again), even though no source changed. On a real repo with
`tsc` packages this is the "everything rebuilds for no reason" churn.

To see *why*, run the watcher with debug logging:

```bash
TURBO_UI=stream npx turbo watch dev --continue -vv 2>&1 | tee watch.log
curl localhost:3000
grep -E "lagged behind|rediscovered packages|processing changed packages" watch.log
```

## What actually happens (root cause)

The write burst into a gitignored directory causes turbo's **package watcher to
rediscover packages**, and a rediscovery re-runs the whole graph regardless of the
dependency wiring, so `cache: false` package tasks execute again with no real
change. The `-vv` log shows the chain:

```
turborepo_filewatch::package_watcher: rediscovered packages: ...   <- forced rescan
turborepo_lib::run::watch: processing changed packages
package-a:dev: [package-a] built ...                              <- re-run, no source changed
package-b:dev: [package-b] built ...
```

Two contributing facts:

1. **The watcher ingests events for gitignored directories.** `.cache/` (like
   `.next/`) is gitignored, but turbo still receives the raw inotify/FSEvents for
   the burst before filtering — enough churn to trigger a package rediscovery.
2. **At higher volume the burst also overflows turbo's bounded event channel**,
   logged as `WARNING lagged behind N processing file watching events`. This isn't
   required to reproduce (a moderate burst rediscovers without any "lagged behind"
   lines), but a larger `BARRAGE_FILES` makes the overflow — and the rebuild —
   more pronounced and can produce multiple rebuild waves per request.

Note this is distinct from #12654 / PR #12678 ("Avoid rerunning non-cacheable watch
dependencies"), which is already present in 2.10.5. That fix addresses re-running
upstream `cache: false` deps when a *dependent changes*; it does not cover the
**write-burst → rediscovery** path, which re-runs everything.

### Observed on two runs (turbo 2.10.5)

| run | `BARRAGE_FILES` | `lagged behind` lines | `rediscovered packages` | packages re-ran? |
|-----|-----------------|-----------------------|-------------------------|------------------|
| 1   | 30000           | 25                    | 2                       | yes (twice)      |
| 2   | 30000           | 0                     | 1                       | yes (once)       |

Same input, different amount of overflow — confirming the rediscovery is the
trigger and the overflow is a volume-dependent aggravator.

## Knobs

`apps/web/dev.mjs` reads two env vars so you can find your machine's overflow
threshold:

- `BARRAGE_FILES` (default `30000`) — files written per request
- `BARRAGE_DIRS` (default `300`) — directories they're spread across

```bash
BARRAGE_FILES=5000 pnpm dev     # smaller burst; may not overflow
BARRAGE_FILES=60000 pnpm dev    # larger burst; overflows more reliably
```

If it doesn't reproduce on the first hit, hit the endpoint a couple more times or
raise `BARRAGE_FILES` — the overflow is inherently timing-dependent (it's a race
between the write burst and how fast turbo drains its event channel).

## Contrast

Swap `turbo watch dev` for `turbo run dev` (with persistent watch tasks) and the
problem disappears — `turbo run` does not do the file-watching / rediscovery that
`turbo watch` does.
