---
name: agentv-git-workflow
description: Use when starting, claiming, committing, pushing, opening, updating, reviewing, merging, or cleaning up AgentV work. Covers Beads as canonical task memory, GitHub as collaboration surface, worktrees, draft PRs, issue workflow, and merge cleanup.
---

# AgentV Git Workflow

## Tracking Model

- Beads is the canonical task tracker and agent memory: task state, dependencies, discoveries, and durable project knowledge.
- GitHub is the collaboration surface: draft PRs, reviews, CI, merge coordination, and communication with other parties.
- Interpret "do not use external issue trackers" as "do not create a second private task brain." It does not replace GitHub collaboration.
- Runtime orchestration should stay lightweight: Beads tracks coordination state, tmux/Codex wrappers run agents, and git worktrees provide isolation. Use `ep-spawn-agent` for generic worktree + tmux spawning when it fits. Do not introduce Gastown/AO unless the missing value is specifically their spawning or dashboard ergonomics.

Use Beads instead of markdown TODO lists:

```bash
bd ready --json
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd update <id> --claim --json
bd close <id> --reason "Completed" --json
bd remember "durable project insight"
bd dolt push
```

Until a `bead-start` helper exists, the manual Beads-first launch flow is:

```bash
bd list
bd show <id>
bd update <id> --status in_progress
git fetch origin
git worktree add ../agentv.worktrees/<id> -b work/<id> origin/main
cd ../agentv.worktrees/<id>
codex-eng
bd close <id>
```

Follow-up automation is tracked in `agentv-9gh`: create Beads glue around `ep-spawn-agent`, not a parallel spawner. The helper should mark a bead in progress, pass the bead id through `EP_TASK_ID` or an equivalent identifier, let `ep-spawn-agent` handle worktree + tmux startup, and write a session note back to the bead.

## Worktrees

For feature, bug fix, or non-trivial repo changes, work from a dedicated sibling worktree based on latest `origin/main`. Keep the primary checkout clean; do not do feature work in the main folder.

```bash
git fetch origin
git worktree add ../agentv.worktrees/<type>-<short-desc> -b <type>/<issue-or-topic>-<short-desc> origin/main
cd ../agentv.worktrees/<type>-<short-desc>
bun install
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
```

AgentV worktrees live in sibling `../agentv.worktrees/`, not `.worktrees/` inside the repo and not the primary checkout.

After checking out a branch or PR, run `bun install` if `package.json` or `bun.lock` may have changed.

## GitHub Issues

When working from a GitHub issue, claim it on the project board before work. If already `In Progress`, do not duplicate work.

Use `AGENT_ID` from `.env`; in this environment default to `devbox2-codex` if unset.

## Draft PRs

After the first meaningful commit, push and open a draft PR. Continue pushing meaningful checkpoints.

```bash
git push -u origin HEAD
gh pr create --draft --title "<type>(scope): summary" --body "Refs <beads-id-or-github-issue>"
```

Do not push directly to `main`.

## PR Readiness

Keep draft until verification evidence is complete: unit tests, test plan evidence, manual red/green UAT for user-facing changes, CI green, no conflicts, and final review pass when warranted.

## Merge and Cleanup

Use squash merge only:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

After squash merge, do not continue pushing to the old branch. Start follow-up fixes from fresh `main`.

Before ending a session, sync Beads, push committed code, and confirm the branch is up to date with its remote.
