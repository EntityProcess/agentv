---
name: agentv-git-workflow
description: Use when starting, claiming, committing, pushing, opening, updating, reviewing, merging, or cleaning up AgentV work. Covers AO-first session/worktree/PR lifecycle, GitHub collaboration, manual fallback worktrees, existing PR takeover, and merge cleanup.
---

# AgentV Git Workflow

## Tracking Model

- AO (Composio Agent Orchestrator) is the orchestration layer for live coding work: assignment, worker ownership, status, worktree lifecycle, PR claiming, and visualization.
- GitHub is the external collaboration surface: PRs, reviews, CI, merge coordination, issues, and human-visible handoff.
- Beads (`bd`) is optional durable planning/backlog context only when explicitly assigned by the user/AO. Do not use Beads as routine live execution tracking in AO-managed sessions.
- Do not create competing task trackers, markdown TODO ledgers, unmanaged agent sessions, or duplicate PRs.

## AO-Managed Sessions

When `AO_SESSION_ID` is present or the task says it is an AO worker session:

1. Acknowledge and report status with AO commands (`ao acknowledge`, `ao report working`, `ao report fixing-ci`, `ao report addressing-reviews`, `ao report needs-input`).
2. Use the AO-provided worktree and branch unless AO/user instructs otherwise.
3. For an existing PR, run `ao session claim-pr <number-or-url>` before editing. If claim or checkout indicates another AO session/worktree owns the branch, coordinate instead of forcing checkout.
4. Push focused commits to the claimed PR branch and report PR milestones with `ao report pr-created --pr-url <url>`, `draft-pr-created`, or `ready-for-review` as appropriate.
5. Do not invoke `ep-spawn-agent`, launch sub-agents, create extra worktrees, or create Beads tasks for live tracking unless AO/user explicitly asks.

## ep-spawn-agent Verdict

`ep-spawn-agent` is disabled for normal AgentV work under AO. It may only be used in a non-AO environment or with explicit AO/user instruction for a Beads experiment. In AO-managed sessions it conflicts with AO ownership, visualization, worktree, and PR lifecycle, so prefer AO workers/harnesses instead.

## Manual Fallback Outside AO

For feature, bug fix, or non-trivial repo changes outside AO, work from a dedicated sibling worktree based on latest `origin/main`:

```bash
git fetch origin
git worktree add ../agentv.worktrees/<type>-<short-desc> -b <type>/<short-desc> origin/main
cd ../agentv.worktrees/<type>-<short-desc>
bun install
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env 2>/dev/null || true
```

Keep the primary checkout clean. Do not push directly to `main`.

## Existing PR Takeover

1. Inspect the PR first:

   ```bash
   gh pr view <number> --json number,title,state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,url
   gh pr checks <number> --watch=false
   ```

2. In AO, claim with `ao session claim-pr <number-or-url>` and use the resulting worktree/branch. If the branch is already used by another worktree, do not force it; coordinate or `cd` into the existing worktree only when that is the safe continuation path.

3. Outside AO, check out the PR branch manually:

   ```bash
   gh pr checkout <number>
   # or: cd /path/to/existing/worktree
   ```

4. Push focused commits to the existing PR branch. Do not create a second PR for the same work.

## PRs and Pushing

After the first meaningful commit, push and open or update a PR. In AO, prefer the PR lifecycle requested by the orchestrator; otherwise open a draft PR for in-progress work.

```bash
git push -u origin HEAD
gh pr create --draft --title "<type>(scope): summary" --body "<summary and verification plan>"
```

Use conventional commit and PR titles: `type(scope): summary`.

## PR Readiness

Keep draft until verification evidence is complete: unit tests, test plan evidence, manual red/green UAT for user-facing changes, CI green, no conflicts, and final review pass when warranted.

Before marking ready:

```bash
gh pr checks <number> --watch=false
gh pr view <number> --json isDraft,mergeStateStatus,reviewDecision,statusCheckRollup
```

## Merge and Cleanup

Use squash merge only when explicitly responsible for merging:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

After squash merge, do not continue pushing to the old branch. Start follow-up fixes from fresh `main`.

Before ending a session, ensure committed work is pushed and report the current state through AO when running under AO.
