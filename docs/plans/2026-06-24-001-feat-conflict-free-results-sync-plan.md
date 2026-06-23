---
title: "feat: Conflict-free results sync without force push"
type: feat
date: 2026-06-24
bead: av-tbd
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
(local-git-first, no Phoenix, no hosted DB, no webhook server required at runtime).

The core recommendation is a **hybrid**:

1. **Auto-merge the common case.** Most result writes are append-mostly and
   line-orthogonal (immutable run bundles under `runs/<exp>/<ts>/`). Replace the
   current `backup_and_force_push` escape hatch with a real **fetch → merge →
   push** loop using artifact-aware merge drivers (`union` for append-only index
   lines, JSON-aware/`-X ours`-scoped for the small mutable overlay). This commits
   a genuine merge instead of overwriting the remote, so no force push is needed
   for the overwhelming majority of pushes.
2. **Fall back to a human-in-the-loop temporary-branch flow only on a true
   conflict.** When a real content conflict cannot be auto-resolved, push the
   local work to a **new timestamped branch** (never the canonical branch), surface
   a compare/PR link, and resume canonical-branch sync once the temp branch tip is
   an **ancestor** of the canonical branch (i.e. actually merged) — not merely when
   the branch is deleted.

This supersedes the `backup_and_force_push` policy as the recommended default and
keeps the prior metadata-conflict UX design
(`docs/plans/2026-06-23-002-feat-remote-result-metadata-conflicts-plan.md`) for the
narrow per-file resolution surface, minus its force-push action.

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
- The force push is leased (`--force-with-lease`) and backed up, so it is not a
  blind `--force`. But it still **rewrites shared history**: any remote commits
  that landed between fetch and push (and are not in the local lineage) survive
  only on the backup ref, not on the canonical branch. Recovery requires someone to
  notice the backup ref and re-merge it. This is exactly the failure mode the repo
  safety norms (`.agents/workflow.md`: "Never force-push", "Never rewrite shared
  history") want to avoid.

### Dashboard / API surface

- `POST /api/remote/sync` and `POST /api/projects/:projectId/remote/sync` call
  `syncRemoteResults()` (`apps/cli/src/commands/results/serve.ts:2942-2999`,
  `apps/cli/src/commands/results/remote.ts:356-385`).
- `syncRemoteResults()` delegates to `syncResultsRepoForProject()` and reports
  status; on error it returns `blocked: true` with the message.
- The prior conflict design
  (`docs/plans/2026-06-23-002-feat-remote-result-metadata-conflicts-plan.md`) adds
  `GET /api/remote/conflicts` and `POST /api/remote/resolve` with three actions:
  `pull_remote_overwrite`, `force_push_local` (backup + lease), and
  `resolve_files` (per-file accept incoming/outgoing). The `force_push_local`
  action is the part this design removes.

### Artifact families (what "merge" means here)

From `docs/plans/results-branch-layout.md` and `results-repo.ts`:

| Family | Path | Mutability | Conflict shape |
| --- | --- | --- | --- |
| Run bundles | `runs/<exp>/<ts>/...` | Immutable, write-once | New files in unique timestamped dirs; **never** overlap between writers |
| Run index | append-only JSONL (e.g. `index.jsonl`) | Append-only | Concurrent appends → both-modified on the same tail lines; line-union resolves cleanly |
| Mutable metadata overlay | `metadata/runs/<exp>/<ts>/tags.json`, `feedback.json` | Editable | Genuine content conflict possible (two writers retag the same run) |

The crucial observation: **only the small editable overlay can truly conflict.**
Run bundles are content-addressed by unique timestamp directories, so two agents
pushing different runs never touch the same path. Index appends are line-orthogonal.
That means a force push is almost never *necessary* — it is being used as a blunt
instrument for a non-fast-forward that a merge would resolve automatically.

---

## Evaluating the Operator's Proposed Workflow

> 1. On divergence, push to a NEW timestamped branch
>    `agentv/results/v1/sync-2026-06-24T01-29-52Z` (never force-push canonical).
> 2. Surface a link / pre-filled PR-compare URL and ask the user to merge that
>    branch into canonical and delete the temp branch.
> 3. Watch the temp branch; when it is **deleted**, resume syncing canonical.

### What works

- **Eliminates force push.** The canonical branch is only ever updated by a merge
  the human/CI performs through normal Git/GitHub, which respects branch protection
  and review. This is the headline win and aligns with `.agents/workflow.md`.
- **Zero data loss.** The diverged local work is preserved on a named remote branch;
  nothing is overwritten.
- **Composable.** A timestamped branch + compare URL is a narrow adapter over
  plain Git; it does not require Phoenix or a hosted DB.
- **Human-auditable.** The merge is a reviewable PR, which fits "portable artifacts
  as source of truth" and "GitHub is the merge surface".

### Failure modes and edge cases

1. **Branch-deletion is an unreliable "merge done" signal.** Deletion and merge are
   independent events:
   - User deletes **without merging** (cleanup, mistake, "this run was junk") →
     Dashboard would wrongly resume canonical sync and the local work is silently
     lost from the canonical branch. **This is a correctness bug.**
   - User merges but **does not delete** (GitHub "delete branch" is optional, or
     auto-delete is off) → Dashboard never resumes; it keeps pushing to a stale
     temp branch forever.
   - User deletes, then **re-pushes** the same branch name (or a new run reuses a
     near-identical timestamp) → ambiguous state; the watcher may flap.
   - Branch protection / org policy **forbids branch deletion** → the signal can
     never fire.

   **Recommendation:** do not key resumption on deletion. Key it on **"the temp
   branch tip is an ancestor of the canonical branch"**, computed locally after a
   fetch:

   ```bash
   git fetch origin
   git merge-base --is-ancestor <temp_tip_sha> origin/<canonical>   # exit 0 ⇒ merged
   ```

   This is true only if the temp branch's content actually reached canonical
   (whether via merge, squash-merge of identical content, or fast-forward), and is
   robust to deletion timing. Deletion can be an **optional cleanup** the Dashboard
   *offers* after detecting the ancestor condition, never the trigger.

   Caveat: **squash merge** (the repo's required merge style — `.agents/workflow.md`
   uses `gh pr merge --squash`) produces a *new* commit whose SHA differs from the
   temp tip, so `--is-ancestor` on the raw tip returns false even though the content
   merged. Detect squash-merge content equivalence instead via patch-id or tree
   comparison of the contributed runs:
   - Preferred: confirm every `runs/<exp>/<ts>/` directory the temp branch added is
     now present at the same path in `origin/<canonical>` with an identical tree
     SHA (`git rev-parse origin/<canonical>:<path>` equals the temp's
     `<path>` tree). Because run bundles are immutable and uniquely pathed, tree
     equality is an exact "this run reached canonical" test that survives squash.
   - This makes run-bundle merge detection **independent of commit SHA**, which is
     the right invariant for append-only content.

2. **Concurrency: N Dashboards/agents pushing temp branches at once.** Each writer
   uses a unique timestamped (and ideally host/pid/random-suffixed) branch name, so
   pushes never collide. Ordering does not matter because the runs they carry live
   in disjoint `runs/<exp>/<ts>/` dirs. The canonical branch absorbs N temp branches
   by N merges; each merge is a fast-forward or trivial union (no path overlap).
   The only true contention is the **mutable overlay** (two writers retag the same
   run) — see the merge-strategy section. **Recommendation:** suffix temp branch
   names with a short random token to avoid same-second collisions:
   `agentv/results/v1/sync-2026-06-24T01-29-52Z-<rand6>`.

3. **Temp-branch sprawl.** Without cleanup, abandoned temp branches accumulate.
   **Recommendation:** the Dashboard tracks the temp branches it created
   (locally, in `.agentv/` state, not committed), shows their status
   (`pending_merge | merged | abandoned`), and offers a one-click delete after the
   ancestor/tree-equality check confirms merge. Optionally a TTL-based "these N
   sync branches are >14 days old and unmerged" nudge.

4. **The human step is unnecessary for the common case.** Per the artifact-family
   table, almost every divergence is auto-mergeable. Forcing a human PR for every
   divergence is heavy and breaks the zero-friction local loop. **Recommendation:**
   make the human temp-branch flow the *fallback*, gated on a real conflict, not
   the default path.

### Polling vs webhook vs local git

- **Webhook**: requires an inbound server / public endpoint → violates zero-infra.
  Rejected for the default path.
- **Local git polling**: `git fetch` + `merge-base --is-ancestor` / tree compare on
  a timer or on Dashboard focus. Zero-infra, works offline-ish, no external service.
  **Recommended.**
- **`gh` enrichment (optional)**: when `gh` is authenticated, the Dashboard can
  *additionally* read PR state to show "merged"/"closed" labels and build a
  pre-filled PR-create URL. This is a narrow optional adapter, never required for
  correctness — the ancestor/tree check from local git remains the source of truth.

---

## Merge Strategy Per Artifact Family

The goal: make merges automatic so the human path is rarely hit and force push is
never needed.

| Family | Strategy | Mechanism |
| --- | --- | --- |
| Run bundles `runs/<exp>/<ts>/**` | Always auto (no overlap) | Disjoint paths ⇒ standard 3-way merge has no conflict. Add a `.gitattributes` safety net but it should never trigger. |
| Append-only index JSONL | Union merge | `.gitattributes`: `index.jsonl merge=union`; lines from both sides are kept. A post-merge normalizer can de-dup/sort by `run_id` if needed (the index is a rebuildable projection per `results-storage-retention-oplog-plan.md` / the SQLite index epic, so worst case it is regenerated). |
| Mutable overlay `metadata/runs/**/tags.json`, `feedback.json` | JSON-aware merge driver; fall back to human path | Custom `merge=agentv-json` driver does a 3-way **set/field union** for tags (add/remove are commutative) and last-writer-wins only on genuine scalar conflicts; if it cannot reconcile, leave conflict markers → triggers the temp-branch fallback. |

Notes:

- `.gitattributes` lives **on the results branch** (committed there), so every clone
  and the storage-branch worktree inherit the merge drivers. Custom drivers
  (`merge=agentv-json`) must be registered in the local git config of the results
  checkout the Dashboard controls; AgentV configures this when it initializes/owns
  the results checkout (it already manages a dedicated checkout / storage-branch
  worktree, so this is a one-time `git config merge.agentv-json.driver ...` on
  setup, not user-facing infra).
- Union/JSON-aware merge means the **fetch → merge → push** loop resolves the
  common case with a real merge commit. Only a genuine overlay conflict (rare) falls
  through to the human temp-branch flow.
- This directly removes the justification for `backup_and_force_push`: a
  non-fast-forward becomes "fetch, merge (auto), push", retried under optimistic
  concurrency.

---

## Recommended Design (Hybrid)

### Sync algorithm (replaces `resolveResultBranchPushConflict` force path)

```
push_results(local_ref, canonical):
  for attempt in 1..N:                      # bounded optimistic retry
    git fetch origin canonical
    if local_ref is ancestor of origin/canonical:   # nothing to do
      return up_to_date
    if origin/canonical is ancestor of local_ref:   # fast-forward
      git push origin local_ref:canonical
      if ok: return pushed
      else: continue                        # someone raced us; retry
    # diverged → try a real merge with artifact-aware drivers
    git merge -m "chore(results): merge remote results" origin/canonical
    if merge clean:                         # union/json drivers resolved it
      git push origin HEAD:canonical
      if ok: return merged_pushed
      else: continue                        # raced; retry from fetch
    else:                                    # TRUE conflict (overlay)
      git merge --abort
      return needs_human_merge              # → temp-branch fallback
  return needs_human_merge                  # exhausted retries
```

- **No force push anywhere.** Push is always fast-forward of canonical (either a
  plain FF or a FF onto a freshly-created merge commit that already contains the
  remote tip).
- Bounded retry handles the benign race where another writer pushes between our
  fetch and push; each retry re-merges the newer remote tip.

### Temp-branch fallback (operator's idea, hardened)

When `needs_human_merge`:

1. Push local work to `agentv/results/v1/sync-<utc_ts>-<rand6>` (create-only push;
   if the name somehow exists, regenerate). Never touch canonical.
2. Record in local Dashboard state (`.agentv/`-scoped, **not committed**):
   `{ temp_branch, tip_sha, contributed_run_paths[], canonical, created_at,
   status: 'pending_merge', compare_url? }`.
3. Surface in the Dashboard:
   - Status chip: `Pending merge` with the temp branch name.
   - A **compare/PR link**. With `gh` available and a GitHub remote, build
     `https://github.com/<owner>/<repo>/compare/<canonical>...<temp_branch>?expand=1`
     (or `gh pr create --web`). Without `gh`, show the branch name and the compare
     path so the user can open it manually.
   - Copy that names exactly what to do: "Merge this branch into `<canonical>`,
     then AgentV will resume normal sync automatically."
4. **Resume signal (robust):** on each poll, `git fetch`, then mark the temp branch
   `merged` when **every** `contributed_run_paths[]` entry has an identical tree SHA
   at the same path on `origin/<canonical>` (squash-safe), or `tip_sha` is an
   ancestor of `origin/<canonical>` (FF/merge-commit case). Only then revert to
   canonical-branch sync.
5. On `merged`: offer (do not force) temp-branch deletion as cleanup.
6. `abandoned` is a UI-only label for a temp branch the user dismisses; AgentV keeps
   its local run workspace intact so nothing is lost.

### Dashboard UX states

`Clean | Ahead | Behind | Syncing | Merged remote (auto) | Pending merge (link) |
Conflict (per-file) | Unavailable`

- `Merged remote (auto)`: transient toast after the fetch→merge→push loop committed a
  real merge — informs the user their push absorbed remote changes with no action.
- `Pending merge (link)`: the temp-branch fallback card with compare/PR URL and
  per-temp-branch status.
- `Conflict (per-file)`: reuse the prior design's
  `GET /api/remote/conflicts` + `POST /api/remote/resolve` **`resolve_files`** action
  (accept incoming/outgoing on the small overlay), but **drop `force_push_local`**.
  After per-file resolution, the push uses the same FF/merge loop above.

### Rationale against the product boundary (`.agents/product-boundary.md`)

- **Zero-infra local to CI:** local-git fetch + merge + ancestor/tree checks; no
  webhook, no Phoenix, no hosted DB. `gh` is an optional enrichment adapter.
- **Portable artifacts as source of truth:** the canonical results branch is only
  ever advanced by real merges; history is never rewritten, so the branch remains a
  trustworthy, append-only-ish record.
- **Small composable core / narrow adapters:** the merge drivers are stock git
  (`union`) plus one tiny JSON driver; the temp-branch flow is plain `git push` to a
  new ref + a compare URL string. No new service.
- **YAGNI:** the human path is only built as a thin fallback; the common case is
  handled by git's own merge machinery. We are not building a CRDT or an event log
  (the prior design already declined `tag-events.jsonl`).
- **Industry alignment:** "push to a branch, open a PR, gate on merge" is the
  lowest-common-denominator GitHub flow; auto-merging append-only data with
  `merge=union` is a well-worn git idiom.

---

## Alternatives Considered

### A. Always-PR flow (push temp branch + open PR for *every* divergence)

- Pros: uniform, fully auditable, branch-protection-friendly.
- Cons: heavy; forces a human/CI round-trip even for trivially auto-mergeable
  appends; breaks the fast local loop. **Rejected as the default**, kept as the
  fallback shape.

### B. Rebase/replay local commits onto updated remote tip

- Replaying local-only results commits onto `origin/canonical` then FF-pushing.
- Pros: linear history.
- Cons: rebase **rewrites** the local commits (new SHAs). If those commits were ever
  shared (e.g. already on a temp branch others fetched), this reintroduces a
  history-rewrite hazard. A **merge** commit is safer and equally automatic for our
  append-only data. **Rejected** in favor of merge; rebase offers no real benefit
  here because we do not care about linear history on the results branch.

### C. Append-only / CRDT-ish layout to make conflicts structurally impossible

- Make even mutable metadata append-only: instead of editing `tags.json`, append
  tag events to a per-writer file (`metadata/runs/<exp>/<ts>/tags/<writer>.jsonl`)
  and fold at read time.
- Pros: zero conflicts *by construction*, including the overlay; the human path
  essentially never triggers.
- Cons: the prior design (`...-002-...`) **explicitly declined** `tag-events.jsonl`
  and per-writer event streams for v1 (KTD6). Adopting it now is a scope increase
  and a layout migration. **Deferred** — but noted as the natural end-state if
  overlay conflicts prove common in practice. The hybrid's JSON-union driver gets
  most of this benefit (add/remove are commutative) without the layout change.

### Comparison vs the operator's raw idea

| Aspect | Operator (delete-to-resync) | Recommended hybrid |
| --- | --- | --- |
| Force push | Avoided | Avoided |
| Common-case friction | Human merge every divergence | Auto-merge, no human |
| Resume signal | Branch deletion (unreliable) | Tree-equality / ancestor (robust, squash-safe) |
| Lost-work risk | Delete-without-merge loses work | None (resume only on confirmed merge) |
| Concurrency | OK (unique branches) | OK + random suffix; auto-merge for overlap |
| Infra | Local git | Local git (+ optional `gh`) |

---

## Phased, Non-Breaking Implementation Plan

### Phase 0 — Merge drivers + `.gitattributes` (foundation)

- Add `.gitattributes` to the results branch with `merge=union` for append-only
  index files; register an `agentv-json` merge driver in the AgentV-owned results
  checkout config.
- Non-breaking: drivers only affect merges AgentV performs; existing branches gain
  the attributes on next write.

### Phase 1 — FF/merge push loop (removes force-push need)

- Replace the `backup_and_force_push` branch in `resolveResultBranchPushConflict`
  (`results-repo.ts:1380-1468`) with the bounded **fetch → merge → push** loop.
- Keep `push_conflict_policy` config key for back-compat but:
  - `'block'` → still blocks on a *true* conflict (now defined as merge-driver
    failure), and routes to the temp-branch fallback instead of suggesting force
    push.
  - `'backup_and_force_push'` → **deprecate**; treat as `'block'` + temp-branch
    fallback, and log a one-time notice. (Same-week/unreleased-surface latitude per
    `.agents/product-boundary.md` §6 may allow hard removal; confirm release state
    first.)
- Tests: temp-remote integration covering FF, auto-merge of disjoint run bundles,
  union index merge, benign push race retry.

### Phase 2 — Temp-branch fallback + robust resume detection

- Core helpers: `pushResultsSyncBranch()` (create-only push to
  `sync-<ts>-<rand6>`), `detectResultsBranchMerged()` (tree-equality + ancestor
  check), `listResultsSyncBranches()` (local state).
- API: extend `POST /api/remote/sync` result to include a `pending_merge` block
  (`temp_branch`, `compare_url`, `contributed_run_count`, `status`); add
  `POST /api/remote/sync-branches/:id/cleanup` for optional deletion.
- Tests: delete-without-merge does **not** resume; squash-merged content **does**
  resume; FF-merged tip resumes; concurrent writers get distinct branches.

### Phase 3 — Dashboard UX

- Add `Pending merge` card and `Merged remote (auto)` toast to `RunSourceToolbar` /
  `project-sync-status`.
- Build compare/PR URL (with optional `gh` enrichment); show per-temp-branch status
  and optional cleanup button.
- Reuse the prior design's per-file conflict view for the overlay, minus
  `force_push_local`.
- Browser UAT per `.agents/verification.md` (evidence to `agentv-private`).

### Phase 4 — (Deferred) Append-only overlay

- Only if overlay conflicts prove common: migrate tags/feedback to per-writer
  append-only event files and fold at read. Revisits KTD6 of the prior design.

---

## Non-Goals

- Force push, blind or leased, anywhere in the design.
- Rewriting shared history (no rebase-and-force of shared branches).
- A webhook server, hosted DB, or Phoenix dependency for sync.
- A CRDT or operation-log layout in v1 (deferred to Phase 4).
- CLI command family for conflict resolution (stays Dashboard/API-owned, per the
  prior design's KTD1).
- Multi-tenant authorization policy for hosted Dashboard force-merge roles.

---

## Open Questions

- Release state of `backup_and_force_push`: can it be hard-removed (same-week,
  unshipped) or must it be deprecated with a compatibility window?
- Should the index JSONL keep `merge=union` permanently, or rely on the rebuildable
  SQLite index (av-2il epic) and treat the on-branch JSONL as best-effort?
- Default retry count `N` and backoff for the optimistic FF/merge loop.
- Whether the Dashboard should auto-open the compare/PR URL or only surface it.
