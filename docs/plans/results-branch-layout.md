# Plan: Flatten on-branch results layout + graceful missing results-branch handling

Branch: `fix/results-branch-layout` — single PR shipping both changes.

## Change 1 — Flatten the on-branch results path (primary)

On the results branch (default `agentv/results/v1`) the `.agentv/results/` prefix is
redundant because the branch name already namespaces results. Flatten the **on-branch /
results-repo-clone** layout:

- `.agentv/results/runs/<exp>/<ts>/...` → `runs/<exp>/<ts>/...`
- `.agentv/results/metadata/runs/<exp>/<ts>/tags.json` → `metadata/runs/<exp>/<ts>/tags.json`

The metadata sidecar is dragged in because `remote-metadata.ts` computes overlay paths
**relative to the on-branch runs dir** and shares the same auto-sync safe-path umbrella as
runs. Leaving it at `.agentv/results/metadata/` would (a) break tag overlays (the relative
manifest computation would resolve outside the runs root and throw) and (b) leave a
half-flattened branch (`runs/` next to `.agentv/results/metadata/`). So both flatten together.

### Scope guard (do NOT change)

The **local working-tree run workspace** stays `.agentv/results/runs/`. That is where
`agentv eval` writes by default and what inspect/trend/export/combine/serve read locally.
Concretely, `resolveResultsRepoRunsDir()` keeps returning `<path>/.agentv/results/runs`
(constant `RESULTS_REPO_RESULTS_DIR='.agentv/results'` is retained solely for that).

### Files to touch

- `packages/core/src/evaluation/results-repo.ts`
  - `RESULTS_REPO_RUNS_DIR`: `${RESULTS_REPO_RESULTS_DIR}/runs` → `'runs'`.
  - Add `RESULTS_REPO_METADATA_DIR='metadata'` and `RESULTS_REPO_TRACKED_DIRS=['runs','metadata']`.
  - `isSafeResultsRepoPath`: accept anything under `runs/` or `metadata/` (was `.agentv/results`).
  - The three `git add --all -- .agentv/results` sites (sync dirty-commit ×1, that same
    block's commit `--` path, `pushWipCheckpoint`) → add the tracked dirs instead.
  - `commitResultsRunWithTemporaryIndex`, `listGitRuns`, `materializeGitRun`, `pushWipCheckpoint`
    all use `RESULTS_REPO_RUNS_DIR` → now `runs`.
  - `resolveResultsRepoRunsDir`: unchanged (local workspace).
- `apps/cli/src/commands/results/remote.ts:462`: literal `.agentv/results/runs` → `runs`.
- `apps/cli/src/commands/results/remote-metadata.ts`:
  - `RESULTS_RUNS_DIR` → `runs`.
  - `REMOTE_METADATA_RUNS_DIR` → `metadata/runs`.

### Breaking change

Prerelease breaking change (acceptable per AGENTS.md / git-native-results.md). Existing
branches written under `.agentv/results/runs/` (and `.agentv/results/metadata/`) will not be
read by the new path. **No read-compat fallback** — documented as a clean breaking change to
keep the surface minimal.

## Change 2 — Treat a not-yet-created results branch as "no remote runs"

`listGitRuns` runs `git ls-tree -r --name-only <ref> runs`. When `<ref>` (the configured
results branch) does not exist yet, git exits non-zero with `fatal: Not a valid object name
<ref>` and the Dashboard logs a full stack on every poll.

Fix at the `listGitRuns` boundary (all callers benefit): wrap the `ls-tree` call, and if the
error matches the "missing ref" predicate, return `[]`. Genuine failures still throw.

Missing-ref predicate (`isMissingGitRefError`) — match (case-insensitive) on combined
stderr+message containing any of:
`not a valid object name`, `unknown revision or path`, `bad revision`, `does not exist`.

`remote.ts` keeps its existing catch for genuine errors and its non-`config.branch` fallback;
with the boundary fix it simply stops firing for the missing-branch case.

## Tests

- `packages/core/test/evaluation/results-repo.test.ts`: flip on-branch path assertions and
  clone-working-tree run creations to `runs/`; add a case: `listGitRuns(repo, 'missing-branch')`
  resolves to `[]` (no throw).
- `apps/cli/test/commands/results/remote-metadata.test.ts`: seed runs at `runs/`, overlays at
  `metadata/runs/`.
- `apps/cli/test/commands/results/serve.test.ts`: `writeRemoteRunArtifact` /
  `writeDirtyRemoteRunArtifact` → `runs/`; `writeRemoteTagMetadataOverlay` → `metadata/runs/`;
  branch-content assertions updated. (Local-workspace run helpers stay `.agentv/results/runs/`.)

## Verify

- `bun test` in `packages/core` and `apps/cli`; typecheck + lint per repo scripts.
- `bun run build` at root; report the built CLI path for dogfooding.
- Manual red/green UAT.
