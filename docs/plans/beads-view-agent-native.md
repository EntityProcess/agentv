# Beads View — agent-native bd views

**Status**: active
**Scope**: one small PR on top of the Beads tooling branch

## Problem

AgentV should not require Beads Viewer as a second required workflow tool. The
useful part of `bv` for agents is not the UI itself; it is the compact,
machine-readable "what is ready, blocked, important, and claimable" view.

The source of truth should remain the repo-local Beads database accessed through
`bd`. `.beads/issues.jsonl` stays a committed export for git review and optional
read-only viewers, not the live read path for agent orchestration.

## Goals

- Add `scripts/beads-view` as a small `bd`-native agent view command.
- Pin all reads to the current repo with `BEADS_DIR="$REPO/.beads"`.
- Avoid requiring an export before read-only agent views.
- Keep `bd` as the only mutation path.
- Preserve explicit export only for commit/handoff workflows:
  `bd export -o .beads/issues.jsonl`.

## Non-goals

- Reimplement the full Beads Viewer graph engine.
- Add a watcher, daemon, cache, or long-lived index.
- Stage or commit `.beads/issues.jsonl` automatically.
- Make `bv` mandatory again.

## Implementation

### U1: Add `scripts/beads-view`

Create a Bun or shell script at `scripts/beads-view` that provides the agent
views needed for normal workflow:

- `scripts/beads-view ready` — wraps `bd ready --json`.
- `scripts/beads-view next` — returns the first ready item plus the matching
  `bd update <id> --claim --json` command.
- `scripts/beads-view blocked` — wraps a `bd` blocked/list view if available,
  or derives blocked issues from `bd list --json`.
- `scripts/beads-view show <id>` — wraps `bd show <id> --json`.
- `scripts/beads-view health` — wraps `bd status --json`.
- `scripts/beads-view export` — explicitly exports `.beads/issues.jsonl` for
  commit/handoff workflows.

Every command must resolve:

```bash
REPO="$(git rev-parse --show-toplevel)"
BEADS_DIR="$REPO/.beads"
```

and pass that environment to `bd`, so an agent cannot accidentally query another
checkout's Beads graph.

### U2: Document the workflow

Update `AGENTS.md` and `.beads/README.md` to describe `scripts/beads-view` as
the preferred agent-native read surface:

- Use `bd` for writes and claims.
- Use `scripts/beads-view` for compact read-only agent views.
- Use `scripts/beads-view export` or the explicit `bd export` command before
  staging Beads graph changes.
- Treat `bv` as optional compatibility only, not a required path.

### U3: Focused verification

Add lightweight verification only if the chosen implementation language makes it
cheap. For a shell wrapper, syntax and behavior checks are enough:

- `bash -n scripts/beads-view` if shell.
- `scripts/beads-view health` returns JSON for this repo.
- `scripts/beads-view ready` returns JSON for this repo.
- `scripts/beads-view next` prints a claim command when ready work exists and
  exits cleanly when none exists.
- `scripts/beads-view export` writes `.beads/issues.jsonl` and preserves the
  issue count reported by `bd count --json`.
- `git diff --check`.
- `rg` confirms active instructions no longer require `bv` or `br`.

## Risks

- `bd` JSON shapes may vary across versions. Keep parsing shallow and avoid
  depending on fields that are not already visible in current command output.
- A wrapper that exports as part of every read would hide stale-state problems
  and mutate the worktree unexpectedly. Reads must not export.
- If `bd blocked` output differs from expected versions, prefer a minimal
  fallback or document that `blocked` is unavailable rather than adding a broad
  parser.
