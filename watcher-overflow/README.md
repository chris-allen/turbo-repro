# watcher-overflow

## Problem

`turbo watch` re-runs every `dev` task in the graph when a dev server writes a large burst of files into a *gitignored* directory. No source files changed, yet the whole dependency graph rebuilds.

| turbo  | pnpm    | node | os    |
|--------|---------|------|-------|
| 2.10.5 | 10.15.1 | 22   | Linux |

## Setup

```text
apps
  └─ web
      └─ dev server (node dev.mjs, persistent: true)
packages
  ├─ package-a
  |   └─ one-shot build (node build.mjs, cache: false)
  └─ package-b
      └─ one-shot build (node build.mjs, cache: false, depends on package-a)
```

This is meant to mimic the shape of a TS monorepo where apps run a persistent server and packages run `tsc`.

`apps/web/dev.mjs` is a stand-in for a bundler. It writes ~30,000 files into `apps/web/.cache/` (which is gitignored), simulating a bundler writing build artifacts on a route compile. Nothing tracked by git ever changes.

## Steps to reproduce

```bash
pnpm install
pnpm dev
```

Hitting `localhost:3000` will (most of the time) trigger the full rebuild of all packages.

### Expected

Nothing re-runs. Only gitignored files under `apps/web/.cache/` are written.

### Actual

All tasks (including both packages) are re-run, even though no source changed.
