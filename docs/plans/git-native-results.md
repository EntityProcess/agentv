# Git-native results storage

**Status**: implemented in prerelease; records the current branch-backed results design
**Tracks**: issue #1259 (supersedes closed PR #1260)
**Scope**: current git-native storage contract; breaking changes accepted before release

---

## Why

`/api/runs` polls every 5s and does O(N) per-manifest reads (`readdir` + `statSync` + `loadResultFile` per run). At hundreds of runs it stalls; at thousands it falls over. The original PR #1260 tried to fix this with an append-only `index/runs.jsonl` file, which works but adds a second source of truth that can drift, grows forever, and requires a sha-amend dance plus a `reindex` migration command.

After comparing with **entireio** (single-ref + git tree as index) and **skillfully** (explicit `sourceMode = github_import` pattern with PR-based writes for human-curated content), the cleaner architecture treats **git as the canonical store**, not as a transport layer.

## Core idea

The configured results branch tree IS the index. `git ls-tree -r <storage-ref> -- runs/` lists every run path by finding `index.jsonl` anchors without reading every blob. `git cat-file --batch` reads those manifest blobs in one subprocess call, and `summary.json` is read opportunistically for run metadata when present. No separate index file. No drift. Natural pruning when runs are deleted. With `--filter=blob:none` clone, individual run blobs are fetched lazily when a user opens the detail view.

## Architecture

### Storage

- `results.repo_path` points at an existing local Git checkout whose object database and refs AgentV may write to. Use `repo_path: .` to store results in a dedicated branch of the source repo without checking that branch out in the source worktree.
- `results.repo_url` points at a remote results repository. AgentV manages a local clone at `results.path`; omit `path` to use the default AgentV data dir.
- `results.branch` is the storage branch. `repo_path` configs default to `agentv/results/v1`.
- Local `.agentv/results/runs/` remains the active run workspace for local Dashboard, resume, and rerun flows. Publishing copies completed run artifacts into the branch-backed store under `runs/**` (the branch name already namespaces results, so no redundant `.agentv/results/` prefix on the branch). Editable tag overlays live alongside under `metadata/runs/**`.

```yaml
# Existing checkout, usually the eval source repo.
results:
  repo_path: .
  branch: agentv/results/v1
  remote: origin
  sync:
    auto_push: true

# Separate results repository.
results:
  repo_url: git@github.com:myorg/eval-results.git
  branch: agentv/results/v1
  path: ~/data/agentv-results
  sync:
    auto_push: true
```

The field is intentionally `repo_path`, not `repo`: `workspace.repos[].repo` is a portable repository identity, while `results.repo_path` is a filesystem path to an already-existing local checkout.

### Writes

Every completed `agentv eval` publish is one atomic operation:

1. Write artifacts into the normal local run workspace at `.agentv/results/runs/<experiment>/<timestamp>/`.
2. Resolve the results store: either the `repo_path` checkout or the managed clone for `repo_url`.
3. Build a commit for `runs/**` (and `metadata/**`) on the storage branch using git plumbing and a temporary index, so `repo_path: .` never has to check out `agentv/results/v1`.
4. If `sync.auto_push` or `sync.require_push` is enabled, push the storage branch. Non-fast-forward conflicts fetch the remote branch, rebuild the single run commit on the remote base when safe, and retry.

Each run is one commit. Files are unique to that run, so rebases never content-conflict.

### Reads

**Listing** (replaces `listResultFilesFromRunsDir`):
- `git ls-tree -r <storage-ref> -- runs/` -> filter for `index.jsonl` paths
- `git cat-file --batch` -> read those manifest blobs in one subprocess
- Read sibling `summary.json` blobs when present for run-level metadata and aggregate display fields
- Derive `run_id` from path (same logic as current `buildRunId`)
- Sort by timestamp descending
- Apply cursor pagination

**Detail view file reads** (replaces `readFileSync(meta.path)`):
- Committed: `git cat-file -p <storage-ref>:runs/.../<file>`
- In-progress (post-write, pre-commit): `readFileSync(<path>)` from working tree

**In-progress detection**: between artifact write and commit, files exist only in the working tree. `git status --porcelain .agentv/results/` surfaces them; merge with the committed list for the Dashboard runs view.

### Sync

- `agentv eval` does its own fetch + commit + optional push for completed runs.
- WIP checkpointing uses a temporary git worktree and force-pushes `agentv/wip/<hostname>/<run-dir-basename>` so interrupted runs can be recovered before final publish.
- Dashboard/API **Sync Project** is the manual remote exchange path: it fetches, fast-forwards or pushes when safe, and reports dirty/diverged/conflicted state.
- `agentv results` remains local-run focused; it does not own remote sync commands.
- For `repo_path`, the source worktree is never switched to the results branch. Completed publishes use a temporary index; WIP checkpoints use a temporary worktree rooted outside the source checkout.

### Pagination

`/api/runs?limit=50&cursor=<run_id>`:
- Cursor is the `run_id` of the last item from the previous page
- Server reads the full sorted list (one `git ls-tree` + one `git cat-file --batch`), finds the cursor, slices `[cursorIdx+1 : cursorIdx+1+limit]`, returns `next_cursor` if more remain
- Dashboard uses `useInfiniteQuery` + an `IntersectionObserver` sentinel row

## Implementation notes

- `normalizeResultsConfig()` accepts `repo_url`/legacy `repo` or `repo_path`, but prerelease docs and config examples use `repo_url` or `repo_path`.
- `directPushResults()` resolves the results store, builds one storage-branch commit for the completed run, and pushes when `sync.auto_push` or `sync.require_push` is enabled.
- `commitResultsRunWithTemporaryIndex()` writes blobs into the repo object database and updates the storage branch via a temporary index. This is the normal `repo_path: .` path and avoids copying files into a checked-out results branch.
- `listGitRuns()` uses `git ls-tree` plus `git cat-file --batch` against `runs/**/index.jsonl`, then reads sibling `summary.json` blobs when present. A not-yet-created storage branch (ref does not exist) returns `[]` rather than throwing, so the Dashboard's remote-results poll stays quiet before the first push.
- `setupWipWorktree()` and `pushWipCheckpoint()` maintain recoverable in-progress branches under `agentv/wip/...`.

## Breaking changes

| Change | Impact |
|--------|--------|
| `results.repo` is legacy | Use `results.repo_url` for a remote clone or `results.repo_path` for an existing local checkout |
| `results.auto_push` moved | Use `results.sync.auto_push`; `results.sync.require_push` is the CI fail-on-push-failure knob |
| `repo_path` configs default to `agentv/results/v1` | Same-repo storage no longer needs an explicit branch in the common case |
| WIP branch namespace is `agentv/wip/...` | Interrupted runs are recoverable, but successful runs delete their WIP branch after final publish |

Breaking changes accepted because no production users yet. Document in release notes; require fresh config to upgrade.

## Test plan

- Unit tests for `git ls-tree` + `git cat-file --batch` parsing helpers
- Integration test that spins up a tmp git repo, writes runs via the new write path, lists via the new read path, asserts results
- Pagination unit tests (cursor in/out of bounds, exact-boundary cases)
- E2E: run an actual eval against a real (test-scoped) results repo, verify the commit lands with the `AgentV-Run:` trailer, `git ls-tree` shows the run, Dashboard renders it

## Deferred to future PRs

- **Zero-config same-repo mode** — infer `repo_path: .` when no `results` block is configured. Independent feature; explicit config stays clearer for prerelease.
- **Multi-mode support** — if a hosted Dashboard gets built later, add a separate top-level transport field then. Do not reserve `mode` in the prerelease schema until there is a second implementation.
- **PR-based publishing** — for human-curated content. Eval results are machine-generated, so direct commit is correct. If users want review-before-merge for sensitive evals (e.g., regulatory benchmarks), add `share: auto-pr` later.
- **In-memory list caching** — P2 from #1259. The git-object-DB read path is fast enough that caching is not needed today. Revisit if profiling shows it's a bottleneck.

## Current answers

1. **Branch model**: completed runs use the configured storage branch, defaulting to `agentv/results/v1` for `repo_path`; WIP checkpoints use `agentv/wip/<hostname>/<run-dir-basename>`.
2. **What to do on `git fetch` failures during `agentv eval`**: warn unless `sync.require_push` is true; local eval artifacts are still written first.
3. **`gh` CLI dependency**: the git-native flow uses raw `git`; GitHub-specific tooling stays outside result publishing.

## What this PR does NOT do

- Doesn't add a separate index file (the index IS the git tree)
- Doesn't ship a `reindex` migration command (nothing to backfill — `summary.json` already exists per run)
- Doesn't change the artifact format (`summary.json`, `index.jsonl`, per-test dirs stay as-is)
- Doesn't add server-side caching (deferred)
- Doesn't add PR-based publishing (deferred)
- Doesn't touch the source repo's normal branch history (only the configured results storage branch/repo)
