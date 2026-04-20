# Studio Runtime Benchmark Discovery (#1144)

## Problem
Studio reads `~/.agentv/benchmarks.yaml` fresh on every `/api/benchmarks` request, so
edits to that file are already picked up live. What doesn't work is **filesystem
discovery**: `--discover <path>` is a one-shot scan at startup, so any `.agentv/`
repo that appears/disappears under that path while `agentv serve` is running is
invisible until restart.

## Design

### Persisted state (benchmarks.yaml)
Extend `BenchmarkRegistry` with an optional `discoveryRoots?: string[]`. This is
the persisted list of directories Studio should continuously scan for
`.agentv/` repos. Existing `benchmarks` entries remain untouched.

### Active-vs-persisted split
Introduce `resolveActiveBenchmarks()` in `packages/core/src/benchmarks.ts`:
- Start with the persisted `benchmarks` array (manually added entries).
- For each discovery root, call `discoverBenchmarks(root)` and generate
  synthetic entries with `source: 'discovered'`. Absolute path is the identity;
  id is derived from basename + dedup against persisted ids.
- Persisted wins on path conflict (so a user can opt a discovered repo into
  manual management).
- Return the merged list. Nothing is written to disk.

This is cheap (depth-2 `readdirSync`) and avoids write contention. Discovered
entries are ephemeral — removing a `.agentv/` directory causes the next scan to
drop it. Manually-added entries are never auto-removed.

### API changes (apps/cli/src/commands/results/serve.ts)
- `/api/benchmarks`, `/api/benchmarks/all-runs`, `/api/benchmarks/:id/summary`,
  and `withBenchmark()` switch from `loadBenchmarkRegistry()` /
  `getBenchmark()` to the resolved list, so discovered entries participate in
  every benchmark-scoped route.
- New endpoints:
  - `GET /api/benchmarks/discovery-roots` → `{ roots: string[] }`
  - `POST /api/benchmarks/discovery-roots` `{ path }` → `{ root }`
  - `DELETE /api/benchmarks/discovery-roots` `{ path }` → `{ ok: true }`
  - `POST /api/benchmarks/rescan` → same shape as `GET /api/benchmarks`

### CLI changes
Add `--discovery-root <path>` (repeatable via `multioption`). Paths are resolved
to absolute and appended to the persisted `discoveryRoots` (idempotent). The
server still starts — this is not a one-shot flag.

The existing `--discover <path>` flag keeps its one-shot semantics for backward
compatibility.

### Wire format
Discovered entries return `source: "discovered"` in the snake_case response so
the frontend can optionally disable the Remove button for them. The default is
`"manual"` (preserving the existing response shape for registered repos).

## Acceptance-criteria mapping

| Criterion                                   | Handled by                              |
| ------------------------------------------- | --------------------------------------- |
| Start with zero projects, stay healthy      | Already works; no change                |
| New `.agentv/` repo appears without restart | `resolveActiveBenchmarks()` on each GET |
| Removed repo disappears without restart     | Same — scan is recomputed per request   |
| `/api/benchmarks` reflects live state       | Same                                    |

## Test plan
1. Unit test `resolveActiveBenchmarks` with temp directories (add + remove
   `.agentv/` and assert the returned list reflects it).
2. Unit test that persisted entries win over discovered ones at the same path.
3. Red/green UAT: start `agentv serve --discovery-root <tmp>`; `curl
   /api/benchmarks` → empty; `mkdir <tmp>/r1/.agentv`; re-curl → shows `r1`;
   `rm -rf <tmp>/r1/.agentv`; re-curl → gone. Same server process throughout.
