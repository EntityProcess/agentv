# Git-native results storage

**Status**: design approved, implementation pending
**Tracks**: issue #1259 (supersedes closed PR #1260)
**Scope**: single PR; breaking changes accepted (no production users yet)

---

## Why

`/api/runs` polls every 5s and does O(N) per-manifest reads (`readdir` + `statSync` + `loadResultFile` per run). At hundreds of runs it stalls; at thousands it falls over. The original PR #1260 tried to fix this with an append-only `index/runs.jsonl` file, which works but adds a second source of truth that can drift, grows forever, and requires a sha-amend dance plus a `reindex` migration command.

After comparing with **entireio** (single-ref + git tree as index) and **skillfully** (explicit `sourceMode = github_import` pattern with PR-based writes for human-curated content), the cleaner architecture treats **git as the canonical store**, not as a transport layer.

## Core idea

The git tree IS the index. `git ls-tree -r origin/main -- runs/` lists every run path without reading any blob. `git cat-file --batch` reads existing `benchmark.json` blobs in one subprocess call. No separate index file. No drift. Natural pruning when runs are deleted. With `--filter=blob:none` clone, individual run blobs are only fetched lazily when a user opens the detail view.

## Architecture

### Storage

- The configured remote `results.repo` is **the** storage location.
- The local clone at `results.path` (filesystem path) is the working copy.
- No more `.agentv/results/runs/` writes in the source project. No more gitignored results.

```yaml
# config.yaml
results:
  mode: github                       # required, only valid value today
  repo: myorg/eval-results           # remote
  path: ~/data/agentv-results        # optional; default ~/.agentv/results/<slug>/
  auto_push: true                    # default
```

`mode: github` is explicit (extension point; mirrors skillfully's `sourceMode` pattern). `path` is the **local filesystem location** of the clone (breaking change — was previously the subdir within the remote repo). Runs always land at `<clone>/runs/<experiment>/<timestamp>/` regardless.

### Writes

Every `agentv eval` is one atomic operation:

1. `git fetch origin --prune` (refresh; no checkout)
2. Write artifacts into working tree at `<clone>/runs/<experiment>/<timestamp>/`
3. `git add runs/<experiment>/<timestamp>/`
4. `git commit -m "<title>" -m "Agentv-Run: <run-id>"` (P6 trailer baked in)
5. If `auto_push`: `git push origin HEAD:main` with retry-on-non-fast-forward (rebase + retry)

Each run is one commit. Files are unique to that run, so rebases never content-conflict.

### Reads

**Listing** (replaces `listResultFilesFromRunsDir`):
- `git ls-tree -r origin/main -- runs/` → filter for `benchmark.json` paths
- `git cat-file --batch` → read those blobs in one subprocess
- Derive `run_id` from path (same logic as current `buildRunId`)
- Sort by timestamp descending
- Apply cursor pagination

**Detail view file reads** (replaces `readFileSync(meta.path)`):
- Committed: `git cat-file -p origin/main:runs/.../<file>`
- In-progress (post-write, pre-commit): `readFileSync(<path>)` from working tree

**In-progress detection**: between artifact write and commit, files exist only in the working tree. `git status --porcelain runs/` surfaces them; merge with the committed list for the Studio runs view.

### Sync

- `agentv eval` does its own fetch + push (no separate sync needed for own work)
- `agentv results sync` = `git fetch origin --prune` (refresh view of others' work)
- No more `git checkout`, no more `git pull --ff-only`
- Studio polls `/api/runs` which reads from git object DB (already current after the most recent fetch)

### Pagination

`/api/runs?limit=50&cursor=<run_id>`:
- Cursor is the `run_id` of the last item from the previous page
- Server reads the full sorted list (one `git ls-tree` + one `git cat-file --batch`), finds the cursor, slices `[cursorIdx+1 : cursorIdx+1+limit]`, returns `next_cursor` if more remain
- Studio uses `useInfiniteQuery` + an `IntersectionObserver` sentinel row

## Implementation passes

The PR is large but bounded. Suggested order within the single PR:

### Pass 1 — config + paths

- Update `ResultsConfig` schema: require `mode: github`, repurpose `path` as filesystem location
- Rename `getResultsRepoCachePaths` → `getResultsRepoLocalPaths`
- Rename `cache_dir` → `local_dir` in `ResultsRepoStatus` (wire format too)
- Add config validation: refuse old-style `path: runs` values with migration message

### Pass 2 — write path

- Replace `.agentv/results/runs/` writes with direct writes to `<results.path>/runs/...`
- `directPushResults` becomes the only write path (rename to `commitAndPushRun` since it's no longer just a "direct push" mode)
- Add `Agentv-Run:` commit trailer
- Drop `git checkout` from `updateCacheRepo` — only `git fetch --prune` remains
- Rename `updateCacheRepo` → `fetchResultsRepo`

### Pass 3 — read path

- New `listResultFilesFromGitTree(repoDir, baseBranch)` using `git ls-tree` + `git cat-file --batch` on `benchmark.json` blobs
- Replace `listResultFilesFromRunsDir` calls for remote runs with the new function
- Detail view reads in `serve.ts` use `git cat-file -p <ref>:<path>` for committed runs
- Working-tree readdir for in-progress runs (detected via `git status --porcelain`)
- Drop `loadLightweightResults` enrichment loop in `handleRuns` — `benchmark.json` already has `target`, `experiment`, and `pass_rate`

### Pass 4 — pagination

- `/api/runs` accepts `limit` and `cursor` query params
- Server slices the sorted list by cursor, returns `next_cursor`
- `RunListResponse` gets `next_cursor?: string`
- Studio: `runListOptions` → `infiniteQueryOptions`
- `RunList.tsx`: flatten pages, add `IntersectionObserver` sentinel

### Pass 5 — cleanup

- Remove the entire P1 PR scope (closed PR #1260): `RunIndexEntry`, `appendToRunIndex`, `readRunIndex`, `reindexResultsRepo`, `agentv results reindex` command, `index/runs.jsonl` writes
- Remove `localResults` listing — local-only mode is no longer supported
- Remove `SourcedResultFileMeta.source` field — runs are no longer "local" or "remote", they're either committed or in-progress
- Update docs site (`apps/web/src/content/docs/`)
- Update skill files (`plugins/agentv-dev/skills/agentv-eval-builder/`)
- Update examples that hardcoded `.agentv/results/runs/` paths

## Breaking changes

| Change | Impact |
|--------|--------|
| `results.repo` becomes required | Users without a results repo can't run evals until they configure one |
| `results.path` repurposed (subdir → filesystem path) | Existing configs with `path: runs` fail loudly with migration message |
| No more `.agentv/results/runs/` writes | Project-local results no longer exist; everything lives in the configured `path` |
| `cache_dir` → `local_dir` in status responses | Studio + any external scripts reading status need to update |
| `SourcedResultFileMeta.source` removed | Studio "source" badge becomes "in progress / shared" |

Breaking changes accepted because no production users yet. Document in release notes; require fresh config to upgrade.

## Test plan

- Unit tests for `git ls-tree` + `git cat-file --batch` parsing helpers
- Integration test that spins up a tmp git repo, writes runs via the new write path, lists via the new read path, asserts results
- Pagination unit tests (cursor in/out of bounds, exact-boundary cases)
- E2E: run an actual eval against a real (test-scoped) results repo, verify the commit lands with the `Agentv-Run:` trailer, `git ls-tree` shows the run, Studio renders it

## Deferred to future PRs

- **P5 zero-config same-repo mode** — write to `refs/agentv/runs/v1` in the source repo when no `results.repo` is configured. Independent feature; design pattern works the same.
- **Multi-mode support** — if a cloud Studio gets built later, `mode: cloud` would mirror skillfully's "managed in Skillfully" mode. The current explicit `mode: github` field is the extension point.
- **PR-based publishing** — for human-curated content. Eval results are machine-generated, so direct commit is correct. If users want review-before-merge for sensitive evals (e.g., regulatory benchmarks), add `share: auto-pr` later.
- **In-memory list caching** — P2 from #1259. The git-object-DB read path is fast enough that caching is not needed today. Revisit if profiling shows it's a bottleneck.

## Open implementation questions

1. **Branch model**: `origin/main` or a dedicated `origin/agentv-runs/main`? Current vote: `main`, since this is a dedicated results repo.
2. **What to do on `git fetch` failures during `agentv eval`**? Current vote: warn, proceed with stale local state, surface the error in Studio. Don't block the eval — local commit always works.
3. **`gh` CLI dependency**: stays scoped to existing PR-related code paths. The new git-native flow uses raw `git` only.

## What this PR does NOT do

- Doesn't add a separate index file (the index IS the git tree)
- Doesn't ship a `reindex` migration command (nothing to backfill — `benchmark.json` already exists per run)
- Doesn't change the artifact format (`benchmark.json`, `index.jsonl`, per-test dirs stay as-is)
- Doesn't add server-side caching (deferred)
- Doesn't add PR-based publishing (deferred)
- Doesn't touch the source repo's commit history (only the configured `results.repo`)
