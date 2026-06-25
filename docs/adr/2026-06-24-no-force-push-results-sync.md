# ADR: Conflict-free results sync without force push

Date: 2026-06-24

Status: Accepted

Bead: av-raf

## Context

AgentV publishes portable run artifacts to a shared results branch (for example
`agentv/results/v1` or `main`) and the Dashboard can sync them. When the local
results branch diverged from the remote, the previous
`sync.push_conflict_policy: backup_and_force_push` policy created a remote backup
ref and then force-pushed the local ref over the canonical branch with a lease.

Even leased and backed up, that path **rewrites shared history**: remote commits
that landed between fetch and push survive only on a backup ref, and recovery
depends on someone noticing it and re-merging. That violates the repo safety
norms in `.agents/workflow.md` ("Never force-push", "Never rewrite shared
history").

The key observation is that results artifacts are almost never in genuine
conflict:

| Family | Path | Mutability | Conflict shape |
| --- | --- | --- | --- |
| Run bundles | `runs/<exp>/<ts>/**` | Immutable, write-once | Unique timestamped dirs; writers never overlap |
| Run index | `index.jsonl` | Append-only | Concurrent appends; line-union resolves cleanly |
| Mutable overlay | `metadata/runs/**/tags.json`, `feedback.json` | Editable | Only this can truly conflict (two writers retag one run) |

So a non-fast-forward push is overwhelmingly something a merge resolves
automatically, and force push was being used as a blunt instrument.

The Dashboard must also stay zero-infra per `.agents/product-boundary.md`: no
Phoenix, hosted DB, or inbound webhook server at runtime.

## Decision

Replace the force-push path with a two-layer, no-force-push design.

**Layer 1 — auto-merge the common case.** On a non-fast-forward results push, run
a bounded `fetch → merge → push` loop using artifact-aware Git merge drivers:
`merge=union` for the append-only `index.jsonl` and a small `agentv-json`
JSON-union driver for the mutable tag/feedback overlay (registered once in the
AgentV-owned results checkout config; `.gitattributes` mirrored into the git dir
so drivers apply on both working-tree and detached `merge-tree` paths). Every
push is a fast-forward of canonical — a plain FF, or a FF onto a merge commit
that already contains the remote tip — so shared history is never rewritten.
A bounded optimistic retry absorbs the benign race where another writer pushes
between our fetch and push.

**Layer 2 — human merge via a GitHub PR on a true conflict.** When `git merge`
(with the drivers) reports a genuine conflict, abort it, leave the canonical
branch untouched, and push the local work to a fresh **flat** timestamped branch
`agentv/results-sync/<utc_ts>-<branch_slug>-<rand6>` (create-only; the flat
`agentv/results-sync/` namespace avoids a directory/file ref conflict with the
canonical `agentv/results/v1`). The Dashboard surfaces a **Pending merge** card
with a GitHub compare/PR link. The user merges that branch into the target on
GitHub — **GitHub's PR is the conflict surface; AgentV builds no merge/diff
editor** — then clicks **OK** ("I merged it — resync"). AgentV then
fast-forward-pulls the target and resumes normal sync.

**Resume is an explicit OK, not auto-detection.** Branch deletion is not a merge
signal (a user can delete without merging, merge without deleting, or be blocked
by branch protection), and the repo's required squash merge gives the merge a new
SHA so ancestor checks fail despite the content merging. An explicit OK avoids
all of it and is safe: a premature OK just pulls a target lacking the local work,
re-diverges on the next push, and re-creates a temp branch — no data loss, no
force push.

`backup_and_force_push` is **hard-deprecated/removed** from supported config:
the value shipped only on the `next` npm tag before stable release, so AgentV
now rejects it with migration guidance instead of preserving a compatibility
alias. Remove the field or set `sync.push_conflict_policy: block`; AgentV never
force-pushes result branches.

## Consequences

- The canonical results branch advances only by real merges; history is never
  rewritten and no push is ever forced.
- The common append-mostly case syncs with no human action.
- True overlay conflicts are routed to GitHub's PR UI plus a one-click resync,
  with no AgentV-built conflict editor.
- Zero-infra holds: local-git fetch/merge/push for Layer 1; a plain push to a new
  ref plus a URL string for Layer 2. `gh`/GitHub compare URLs are optional
  enrichment, never required.
- Temp-branch cleanup is out of AgentV scope — the user owns the GitHub merge, so
  deletion is GitHub auto-delete-on-merge or manual cleanup.

## Alternatives Considered

- **Auto-detect the merge (tree-equality / ancestor) instead of an OK button.**
  Must be squash-safe across every contributed run bundle and must distinguish
  merge from deletion — meaningfully more code for a signal the user gives in one
  click. Rejected.
- **Backup + force-with-lease (the previous policy).** Rewrites shared history;
  concurrent remote commits survive only on a backup ref. Rejected/removed.
- **Per-file conflict-resolution UI (av-xwm).** Duplicates GitHub's PR UI; heavy
  to build and maintain. Rejected — GitHub's PR is the conflict surface. The
  av-xwm optimistic-concurrency guard for stale tag writes remains independently
  useful, but its merge UI is not a dependency here.
- **Rebase/replay local commits onto the remote tip.** Rewrites local SHAs and
  reintroduces a history-rewrite hazard if those commits were ever shared (e.g.
  on a temp branch); linear history is not valued on the results branch.
  Rejected in favor of merge.
- **Append-only / CRDT overlay (per-writer tag event files).** Makes overlay
  conflicts structurally impossible but requires a layout migration. Deferred as
  a potential end-state only if overlay conflicts prove common; the JSON-union
  driver already gets most of the benefit since add/remove commute.

## Implementation

Delivered in phases under epic av-raf (all non-breaking):

- Phase 0 — `.gitattributes` + `agentv-json` merge driver registration (#1506).
- Phase 1 — bounded `fetch → merge → push` loop replacing the force-push path
  (#1506); `backup_and_force_push` hard-deprecated before stable release
  (#1510).
- Phase 2 — temp-branch fallback + `confirm-merge` (OK-to-resync) API (#1507).
- Phase 3 — Dashboard **Pending merge** card with the GitHub link + resync button
  (#1508).
- Phase 4 (deferred) — append-only overlay layout, only if overlay conflicts
  prove common in practice.

## Non-Goals

- Force push (blind or leased) or any rewrite of shared history.
- A webhook server, hosted DB, or Phoenix dependency for sync.
- An AgentV merge/diff/conflict-editor UI.
- Automatic merge detection (tree-equality / ancestor / deletion watching).
- Temp-branch deletion/cleanup by AgentV.
- A CLI command family for conflict resolution (stays Dashboard/API-owned).
