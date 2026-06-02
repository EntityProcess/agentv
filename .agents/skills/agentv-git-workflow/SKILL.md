---
name: agentv-git-workflow
description: Use when starting, claiming, committing, pushing, opening, updating, reviewing, merging, or cleaning up AgentV work. Covers Beads as decentralized orchestration, GitHub as collaboration surface, worktrees, draft PRs, existing PR takeover, and merge cleanup.
---

# AgentV Git Workflow

## Tracking Model

- Beads is the decentralized orchestration layer: task state, ownership, dependencies, discoveries, and durable project knowledge live in the bead graph.
- GitHub is the collaboration surface: draft PRs, reviews, CI, merge coordination, and communication with other parties.
- Interpret "do not use external issue trackers" as "do not create a second private task brain." GitHub PRs still handle code review and merge state.
- Runtime stays lightweight: Beads tracks durable coordination state, `ep-spawn-agent` or manual worktree setup launches disposable workers, and git worktrees provide isolation.

Use Beads instead of markdown TODO lists:

```bash
bd ready --json
bd show <id> --json
bd create "Issue title" --description="Detailed context" -t bug|feature|task|chore|epic -p 0-4 --json
bd update <id> --claim --json
bd update <id> --status in_progress --json
bd close <id> --reason "Completed" --json
bd remember "durable project insight"
bd dolt push
```

## Starting New Bead Work

Prefer a bead-aware launcher when available:

```bash
ep-spawn-agent <bead-id>
```

The launcher should:

1. read the bead with `bd show <bead-id> --json`;
2. claim or mark it in progress;
3. create a fresh sibling worktree from latest `origin/main`;
4. launch the agent with bead context;
5. write the session/worktree/branch note back to the bead.

Manual fallback:

```bash
bd show <id> --json
bd update <id> --claim --json
bd update <id> --status in_progress --json
git fetch origin
git worktree add ../agentv.worktrees/<id> -b work/<id> origin/main
cd ../agentv.worktrees/<id>
bun install
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
codex-eng
```

## Worktrees

For feature, bug fix, or non-trivial repo changes, work from a dedicated sibling worktree based on latest `origin/main`. Keep the primary checkout clean; do not do feature work in the main folder.

AgentV worktrees live in sibling `../agentv.worktrees/`, not `.worktrees/` inside the repo and not the primary checkout.

After checking out a branch or PR, run `bun install` if `package.json` or `bun.lock` may have changed.

## Existing PR Takeover

When continuing an existing PR, keep the PR branch as the source of truth for code and use Beads for durable task state/handoff.

1. Inspect the PR first:

   ```bash
   gh pr view <number> --json number,title,state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,url
   gh pr checks <number> --watch=false
   ```

2. Check out the PR branch. If Git reports the branch is already used by another worktree, do not force it; `cd` into that existing worktree instead.

   ```bash
   gh pr checkout <number>
   # or: cd /path/to/existing/worktree
   ```

3. Make or update a bead for the continuation if one is not already provided. Reference the PR number in the bead description or notes.

   ```bash
   bd create "Continue PR <number>: <summary>" --description="Current state, requested changes, and handoff context" -t task -p 1 --json
   bd note <id> "Working tree: <path>; PR: https://github.com/EntityProcess/agentv/pull/<number>"
   ```

4. Push focused commits to the existing PR branch. Do not create a second PR for the same work.

## Draft PRs

After the first meaningful commit, push and open a draft PR. Continue pushing meaningful checkpoints.

```bash
git push -u origin HEAD
gh pr create --draft --title "<type>(scope): summary" --body "Refs <bead-id>"
bd note <bead-id> "Draft PR: <url>"
```

Do not push directly to `main`.

## PR Readiness

Keep draft until verification evidence is complete: unit tests, test plan evidence, manual red/green UAT for user-facing changes, CI green, no conflicts, and final review pass when warranted.

Before marking ready:

```bash
gh pr checks <number> --watch=false
gh pr view <number> --json isDraft,mergeStateStatus,reviewDecision,statusCheckRollup
bd note <bead-id> "Verification complete: <summary>"
```

## Merge and Cleanup

Use squash merge only:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

After squash merge, do not continue pushing to the old branch. Start follow-up fixes from fresh `main`.

Before ending a session:

```bash
git status
bd dolt push
git push
git status
```

Work is not complete until both Beads state and git commits are pushed.
