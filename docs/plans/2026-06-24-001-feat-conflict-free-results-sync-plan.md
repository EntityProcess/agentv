---
title: "feat: Conflict-free results sync without force push"
type: feat
date: 2026-06-24
bead: av-raf
related:
  - docs/plans/2026-06-23-002-feat-remote-result-metadata-conflicts-plan.md
  - docs/plans/2026-06-10-remote-results-cli-contract.md
  - docs/plans/git-native-results.md
  - docs/plans/results-branch-layout.md
---

# feat: Conflict-free results sync without force push

## Summary

Design a results-sync workflow for AgentV that never force-pushes a shared branch
and never rewrites shared history, while keeping the Dashboard zero-infra
(local-git-first; no Phoenix, no hosted DB, no inbound webhook server).

Two layers, deliberately small:

1. **Auto-merge the common case.** Most result writes are append-mostly and
   line-orthogonal (immutable run bundles under `runs/<exp>/<ts>/`, append-only
   index JSONL). On a non-fast-forward push, run a bounded **fetch → merge → push**
   loop using artifact-aware merge drivers (`union` for the index, a small
   JSON-union driver for the mutable overlay). This commits a real merge instead of
   overwriting the remote, so force push is never needed for the overwhelming
   majority of pushes.
2. **Human merge via a GitHub PR only on a true conflict.** When a real content
   conflict cannot be auto-resolved, push the local work to a **new timestamped
   branch** (never the canonical branch) and surface a compare/PR link. The user
   merges that branch into the target branch (`main` or `agentv/results/v1`) using
   **GitHub's own PR/merge UI** — AgentV builds **no merge UI of its own**. When the
   user has merged, they click **OK** in the Dashboard; AgentV pulls the target
   branch and resumes normal sync.

The resume signal is an **explicit user confirmation ("OK")**, not branch deletion
and not automatic merge detection. This keeps the design tiny: no squash-safe
ancestor detection, no merge-state polling, no per-file conflict editor.

This supersedes the `backup_and_force_push` policy as the recommended default. It
does **not** depend on building the per-file conflict-resolution UI from
`docs/plans/2026-06-23-002-feat-remote-result-metadata-conflicts-plan.md` (av-xwm);
GitHub's PR is the conflict surface instead.

This is a design artifact only. It does not implement a broad change.

---

## Current Behavior

### Results sync + push

- Config: `results.sync.{auto_push, require_push, push_conflict_policy}` where
  `push_conflict_policy: 'block' | 'backup_and_force_push'`
  (`packages/core/src/evaluation/loaders/config-loader.ts:40`,
  `packages/core/src/evaluation/results-repo.ts:230-249`).
- Sync status can be `clean | ahead | behind | diverged | conflicted |
  push_conflict | ...` (`results-repo.ts:80-83`).
- On a non-fast-forward push, `resolveResultBranchPushConflict()` runs
  (`results-repo.ts:1380-1468`):
  - `block` → return `sync_status: 'push_conflict'`, blocked, with a message telling
    the user to switch to `backup_and_force_push`
    (`buildBlockedPushConflictReason`, `results-repo.ts:1374-1378`).
  - `backup_and_force_push` → create a remote backup ref
    `agentv/backups/<utc_ts>-<branch_slug>-<short_sha>` from the **current remote
    commit** (`buildResultsBackupRef`, `results-repo.ts:1341-1345`), then
    `git push --force-with-lease=refs/heads/<branch>:<remoteCommit>` the local ref
    over the canonical branch (`results-repo.ts:1440-1459`).
- The force push is leased and backed up, so it is not a blind `--force`. But it
  still **rewrites shared history**: remote commits that landed between fetch and
  push survive only on the backup ref, not on the canonical branch, and recovery
  requires someone to notice that ref and re-merge it. This is exactly what the repo
  safety norms (`.agents/workflow.md`: "Never force-push", "Never rewrite shared
  history") want to avoid.

### Dashboard / API surface

- `POST /api/remote/sync` and `POST /api/projects/:projectId/remote/sync` call
  `syncRemoteResults()` (`apps/cli/src/commands/results/serve.ts:2942-2999`,
  `apps/cli/src/commands/results/remote.ts:356-385`).
- `syncRemoteResults()` delegates to `syncResultsRepoForProject()` and reports
  status; on error it returns `blocked: true` with the message.

### Artifact families (what "merge" means here)

From `docs/plans/results-branch-layout.md` and `results-repo.ts`:

| Family | Path | Mutability | Conflict shape |
| --- | --- | --- | --- |
| Run bundles | `runs/<exp>/<ts>/...` | Immutable, write-once | New files in unique timestamped dirs; **never** overlap between writers |
| Run index | append-only JSONL | Append-only | Concurrent appends → both-modified on the tail; line-union resolves cleanly |
| Mutable overlay | `metadata/runs/<exp>/<ts>/tags.json`, `feedback.json` | Editable | Genuine content conflict possible (two writers retag the same run) |

The crucial observation: **only the small editable overlay can truly conflict.**
Run bundles are uniquely pathed by timestamp, so two agents pushing different runs
never touch the same path. Index appends are line-orthogonal. So a force push is
almost never *necessary* — it is being used as a blunt instrument for a
non-fast-forward that a merge resolves automatically.

---

## Recommended Design

### Layer 1 — Auto-merge push loop (replaces the force-push path)

```
push_results(local_ref, canonical):
  for attempt in 1..N:                      # bounded optimistic retry
    git fetch origin canonical
    if local_ref is ancestor of origin/canonical: return up_to_date
    if origin/canonical is ancestor of local_ref:        # fast-forward
      git push origin local_ref:canonical
      if ok: return pushed else: continue   # raced; retry
    # diverged → try a real merge with artifact-aware drivers
    git merge -m "chore(results): merge remote results" origin/canonical
    if merge clean:                          # union/json drivers resolved it
      git push origin HEAD:canonical
      if ok: return merged_pushed else: continue
    else:                                     # TRUE conflict (overlay only)
      git merge --abort
      return needs_human_merge               # → Layer 2
  return needs_human_merge
```

- **No force push anywhere.** Every push is a fast-forward of canonical (a plain FF,
  or a FF onto a merge commit that already contains the remote tip).
- Bounded retry handles the benign race where another writer pushes between our
  fetch and push.

#### Merge strategy per artifact family

| Family | Strategy | Mechanism |
| --- | --- | --- |
| Run bundles `runs/<exp>/<ts>/**` | Always auto (no overlap) | Disjoint paths ⇒ standard 3-way merge never conflicts. |
| Append-only index JSONL | Union merge | `.gitattributes`: `index.jsonl merge=union`. Index is a rebuildable projection (see the SQLite index epic / `results-storage-retention-oplog-plan.md`), so worst case it is regenerated. |
| Mutable overlay `tags.json`, `feedback.json` | JSON-union driver; else human path | `merge=agentv-json` does a 3-way set/field union for tags (add/remove are commutative); if it cannot reconcile a genuine scalar conflict, it leaves the file conflicted → Layer 2. |

`.gitattributes` lives on the results branch; the `agentv-json` driver is registered
once in the AgentV-owned results checkout config when AgentV initializes it (it
already manages a dedicated checkout / storage-branch worktree, so this is a one-time
`git config`, not user-facing infra).

### Layer 2 — Human merge via GitHub PR + explicit OK (only on true conflict)

When Layer 1 returns `needs_human_merge`:

1. **Push to a new timestamped temp branch**, never canonical:
   `agentv/results/v1/sync-<utc_ts>-<rand6>` (create-only push; `<rand6>` avoids
   same-second collisions between concurrent writers).
2. **Surface a link** in the Dashboard:
   - A **compare/PR URL**. With a GitHub remote and `gh`, build
     `https://github.com/<owner>/<repo>/compare/<target>...<temp_branch>?expand=1`
     (or `gh pr create --web`). Without `gh`, show the branch name + compare path.
   - Status chip: `Pending merge` with the temp branch name and a copy line:
     "Merge this branch into `<target>` on GitHub, then click OK."
3. **The user merges the PR on GitHub.** GitHub's PR/merge/conflict UI is the
   resolution surface; AgentV renders **no diff/merge editor**.
4. **The user clicks OK** in the Dashboard.
5. AgentV **pulls the target branch** (`git fetch` + fast-forward / merge of
   `origin/<target>` into the local results checkout) and resumes normal sync.

#### Why an explicit OK instead of auto-detecting the merge

Auto-detecting "the temp branch was merged" is surprisingly hard and was the main
complexity in earlier drafts:

- **Branch deletion is not a merge signal.** A user can delete without merging
  (loses work), merge without deleting (never resumes), or be blocked from deleting
  by branch protection.
- **Squash merge** (the repo's required style — `.agents/workflow.md` uses
  `gh pr merge --squash`) gives the merge a *new* SHA, so the temp tip is not an
  ancestor of the target even though the content merged. Detecting it requires
  tree-equality comparison of every contributed run bundle — extra machinery for a
  signal the user can simply give us.

An explicit OK sidesteps all of it. It is also **safe**: if the user clicks OK
*without* having merged, AgentV just pulls the target (which lacks their work),
re-diverges on the next push, and re-creates a temp branch. Local run artifacts are
never lost, so a premature OK only costs one extra loop — no data loss, no force
push.

#### Concurrency

Each writer uses a unique `sync-<ts>-<rand6>` branch, so temp pushes never collide,
and the runs they carry live in disjoint `runs/<exp>/<ts>/` dirs. The target branch
absorbs N temp PRs through N normal merges. The only true contention is the mutable
overlay, which Layer 1's JSON-union driver already handles for add/remove; a genuine
scalar overlay conflict is the rare case that reaches a PR.

### Dashboard UX states

`Clean | Ahead | Behind | Syncing | Merged remote (auto) | Pending merge (link) |
Unavailable`

- `Merged remote (auto)`: transient toast after Layer 1 committed a real merge — the
  user's push absorbed remote changes with no action.
- `Pending merge (link)`: Layer 2 card with the temp branch name, the compare/PR
  link, and a single **OK** button ("I merged it — resync"). Optionally an
  `gh`-enriched label showing the PR is merged/closed, as a convenience only; the OK
  button remains the trigger.
- No per-file conflict view, no inline diffs, no accept-incoming/outgoing buttons.

### Detecting "true conflict" vs auto-mergeable

The split is purely whatever `git merge` (with the configured drivers) decides:
clean merge ⇒ Layer 1 pushes; conflicted merge ⇒ Layer 2. AgentV does not classify
conflicts itself, which keeps the core tiny.

### Rationale against the product boundary (`.agents/product-boundary.md`)

- **Zero-infra local to CI:** local-git fetch/merge/push for Layer 1; a plain
  `git push` to a new ref + a URL string for Layer 2. `gh` is an optional
  enrichment, never required. No webhook, no Phoenix, no hosted DB.
- **Portable artifacts as source of truth:** canonical branch advances only by real
  merges; history is never rewritten.
- **Small composable core / narrow adapters:** stock git `union` + one tiny JSON
  driver; the human path is "push a branch, open a PR on GitHub, click OK."
- **YAGNI:** no merge UI, no squash-safe detection, no event log/CRDT. The heaviest
  earlier idea (per-file conflict editor from av-xwm) is explicitly **not** built.
- **Industry alignment:** "push a branch, open a PR, merge it on GitHub" is the
  lowest-common-denominator flow; `merge=union` for append-only data is a standard
  git idiom.

---

## Alternatives Considered

### A. Auto-detect merge (tree-equality / ancestor) instead of an OK button

- Pros: no human click; could auto-resume.
- Cons: must be squash-safe (tree-equality across every contributed run bundle) and
  must distinguish merge from deletion; meaningfully more code and edge cases for a
  signal the user can give in one click. **Rejected** in favor of explicit OK.

### B. Backup + force-with-lease (current `backup_and_force_push`)

- Pros: no human step.
- Cons: rewrites shared history; concurrent remote commits survive only on a backup
  ref. Violates repo safety norms. **Removed** by this design.

### C. Per-file conflict-resolution UI (av-xwm)

- Build incoming/outgoing accept buttons + inline diffs in the Dashboard.
- Cons: heavy UI to build and maintain; duplicates what GitHub's PR UI already does.
  **Rejected** — GitHub's PR is the conflict surface. The av-xwm design's optimistic
  concurrency for *stale tag writes* remains independently useful, but its conflict
  *merge UI* is not a dependency here.

### D. Rebase/replay local commits onto the remote tip

- Cons: rewrites local commit SHAs; if those were ever shared (e.g. on a temp
  branch) it reintroduces a history-rewrite hazard, and we do not care about linear
  history on the results branch. **Rejected** in favor of merge.

### E. Append-only / CRDT overlay (per-writer tag event files)

- Makes even overlay conflicts structurally impossible.
- Cons: a layout migration the prior design explicitly declined (KTD6). The JSON
  union driver already gets most of the benefit (add/remove commute). **Deferred**
  as a potential end-state only if overlay conflicts prove common.

---

## Phased, Non-Breaking Implementation Plan

### Phase 0 — Merge drivers + `.gitattributes`

- Add `.gitattributes` (`merge=union` for the index) to the results branch; register
  the `agentv-json` driver in the AgentV-owned results checkout config.
- Non-breaking: drivers only affect merges AgentV performs.

### Phase 1 — Auto-merge push loop (removes the force-push need)

- Replace the `backup_and_force_push` branch in `resolveResultBranchPushConflict`
  (`results-repo.ts:1380-1468`) with the bounded fetch → merge → push loop.
- Keep `push_conflict_policy` for back-compat but deprecate `backup_and_force_push`:
  treat it as `'block'` + route true conflicts to Layer 2. Same-week/unreleased
  latitude (`product-boundary.md` §6) may allow hard removal — confirm release state.
- Tests (temp-remote integration): FF push, auto-merge of disjoint run bundles,
  union index merge, benign push-race retry.

### Phase 2 — Temp-branch + OK-to-resync

- Core helpers: `pushResultsSyncBranch()` (create-only push to
  `sync-<ts>-<rand6>`) and `pullResultsTargetBranch()` (fetch + FF/merge target into
  the local checkout, invoked on OK).
- API: extend `POST /api/remote/sync` to return a `pending_merge` block
  (`temp_branch`, `compare_url`, `contributed_run_count`); add
  `POST /api/remote/sync/confirm-merge` (the OK action) that pulls the target and
  returns refreshed status.
- Tests: true overlay conflict produces a temp branch + pending_merge payload; OK
  pulls the target and clears pending state; premature OK (target not actually
  merged) re-diverges without data loss.

### Phase 3 — Dashboard UX

- `RunSourceToolbar` / `project-sync-status`: `Merged remote (auto)` toast and a
  `Pending merge` card with the compare/PR link and an **OK** button.
- Optional `gh` enrichment to label the PR state (convenience only).
- Browser UAT per `.agents/verification.md` (evidence to `agentv-private`).

### Phase 4 — (Deferred) Append-only overlay

- Only if overlay conflicts prove common in practice (Alternative E).

---

## Non-Goals

- Force push, blind or leased, anywhere.
- Rewriting shared history (no rebase-and-force of shared branches).
- A webhook server, hosted DB, or Phoenix dependency for sync.
- An AgentV merge/diff/conflict-editor UI — GitHub's PR is the conflict surface.
- Automatic merge detection (tree-equality/ancestor/deletion watching) — replaced by
  an explicit OK.
- A CRDT or operation-log overlay layout in v1 (deferred to Phase 4).
- A CLI command family for conflict resolution (stays Dashboard/API-owned).

---

## Open Questions

- Release state of `backup_and_force_push`: hard-remove (same-week, unshipped) or
  deprecate with a compatibility window?
- Keep `merge=union` on the index permanently, or rely on the rebuildable SQLite
  index and treat the on-branch JSONL as best-effort?
- Default retry count `N` and backoff for the optimistic loop.
- Should the OK action also offer optional temp-branch cleanup (delete the merged
  `sync-*` branch), or leave that to GitHub auto-delete-on-merge?
