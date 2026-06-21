# Workflow

This file expands [AGENTS.md](../AGENTS.md) for day-to-day repo work: tracker handling, worktrees, planning, execution, git workflow, PR flow, and documentation update expectations.

## Tracker and Repo Safety

- Treat task-tracking instructions as operator-supplied context. If the prompt provides an external tracker database, path, or environment variable, use that exact tracker for assignment, status, dependencies, handoff notes, decomposition, and resumability.
- If no external tracker is supplied, work from the user's prompt and the current branch or PR. Do not create, sync, stage, or commit repo-local tracker state unless the user explicitly requests it.
- Keep private launcher names, local paths, session aliases, dispatch policy, and operator workspace details outside this public repository.
- GitHub remains the PR, CI, review, and merge surface. Use GitHub Issues or Projects for external collaboration only when the user or operator explicitly asks for that workflow.
- Do not add repo-local tracker directories, tracker JSONL exports, dispatch logs, cross-repo research records, or operator decision records to AgentV commits unless the user explicitly asks for repository-local tracker artifacts.
- If using Beads, follow the global Beads skill. The only repo-local Beads files intentionally tracked are `.beads/config.yaml` and `.beads/.gitignore`; `.beads/metadata.json` and runtime state stay checkout-local.
- Do not commit project-local coordination config files. The safe Beads defaults above are the exception.
- Do not use `git stash` on shared checkouts. Inspect `git status`, stage only your files, use a dedicated worktree, or ask before moving uncommitted changes.

## Worktree Setup

- Start every repo change with `git fetch origin` and `git status --short --branch`.
- Prefer the primary checkout for small, bounded work only when local `main` is current with `origin/main` or can be fast-forwarded cleanly, the change is narrow, and the paths you need are not dirty or owned by another worker in the supplied tracker.
- When working in the primary checkout, stage explicit paths only. Do not commit another agent's files, project-local coordination config, generated evidence, or unrelated tracker or doc state.
- Use a dedicated git worktree based on the latest `origin/main` for non-trivial, risky, cross-cutting, long-running, or parallel implementation, or whenever the primary checkout is stale or dirty in paths you need.
- Before starting implementation in a dedicated worktree, verify its `HEAD` is based on the current `origin/main` commit.

Manual setup:

```bash
git fetch origin
git worktree add ../agentv.worktrees/<type>-<short-desc> -b <type>/<issue-or-topic>-<short-desc> origin/main
cd ../agentv.worktrees/<type>-<short-desc>
```

- Use the sibling `../agentv.worktrees/` directory for all AgentV worktrees. Do not create new AgentV worktrees inside the repository root.
- After creating a manual worktree, run:

```bash
bun install
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
```

- Both steps are required before running builds, tests, or evals in the worktree.
- If you discover you are on a stale base or have uncoordinated dirty files, stop and fix that before changing code.
- Whenever you `git checkout`, `gh pr checkout`, `git pull`, or otherwise switch to a ref that may have changed `package.json` or `bun.lock`, run `bun install` before building or testing.

## Planning and Execution

- Use plan mode or an explicit task list for non-trivial work, roughly five or more steps or anything with architectural decisions.
- If something goes sideways, stop and re-plan instead of pushing a broken approach.
- For non-trivial changes, pause and ask whether there is a more elegant solution before diving in.
- Check in with the user before implementation on ambiguous tasks.
- Prefer automation: execute the requested work without extra confirmation unless blocked by missing information, safety concerns, or an irreversible action the user has not approved.
- For complex problems, keep this worker focused on its assigned scope and create or claim additional tracker items when the supplied tracker supports that workflow.
- When you spot a bug, fix it. Only ask when there is genuine ambiguity about intent.
- Every change should be as simple as possible. Import existing code and fix root causes directly.
- Provide high-level progress updates at natural milestones. If scope changes, communicate it and adjust the plan.

## Review and Documentation Expectations

- Before declaring a repo change complete or opening or finalizing a PR, complete manual E2E verification first, then run a final review pass when warranted. If E2E fails, fix that before spending time on review.
- When making functionality changes, update the human docs in `apps/web/src/content/docs/`.
- If the change affects YAML schema, grader types, or CLI commands, update `plugins/agentv-dev/skills/agentv-eval-builder/` as the AI-focused reference card.
- Update `examples/` when example code, scripts, or eval YAML files exercise the changed functionality.
- Keep `README.md` minimal and link out to agentv.dev for full human-facing docs.

## Git and PR Workflow

Commit convention:

- Follow conventional commits: `type(scope): description`
- Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Issue and tracker workflow:

- Use the operator-supplied tracker, when present, for live ownership and GitHub for external collaboration.
- Do not duplicate claim state in a second live tracker.
- Push focused commits to the assigned branch and open or update the PR requested by the tracker item or user.
- A branch, pushed commit, or draft PR is not done for ordinary scoped work.
- Mark tracker items complete only after the scoped work is complete, verified, merged to `main` through a PR, and documented with verification evidence.
- If the work intentionally remains on an ongoing branch, open a draft PR and record the branch name, PR URL, worktree path, current head commit, and remaining scope in the parent tracker item. Keep the child item open or in progress until the PR is merged or explicitly superseded.
- If a commit is a self-contained unit of completed, verified work, push it directly to its assigned remote branch instead of leaving it local for handoff. This does not override the rule against pushing directly to `main`.
- Do not merge feature, worker, or integration branches into local `main` to stage completion. If multiple branches need integration, create an integration branch, push it, and review it through a PR.

GitHub issue flow:

```bash
gh issue view <number> --repo EntityProcess/agentv --json number,title,state,projectItems,assignees,url
git fetch origin
git worktree add ../agentv.worktrees/<branch-name> -b <type>/<issue-number>-<short-description> origin/main
cd ../agentv.worktrees/<branch-name>
bun install
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
```

After the first meaningful commit, push and open a draft PR unless the user directs a different PR lifecycle:

```bash
git push -u origin <branch-name>
gh pr create --draft --title "<type>(scope): description" --body "Closes #<issue-number>"
```

- Complete E2E verification before marking a PR ready for review.
- Never push directly to `main`, force-push `main`, or merge work into `main` outside GitHub. Every change that reaches `main` must go through a PR with GitHub Actions as the merge gate.
- GitHub Issues and Projects are external collaboration surfaces, not a substitute for operator-supplied tracker state unless explicitly directed.
- `bug` marks defects. Issues without `bug` are non-bug work by default.
- `core`, `wui`, and `tui` are area labels.
- Keep issue bodies focused on objective, design latitude, acceptance signals, non-goals, and related links.
- Do not put priority metadata in issue bodies.

Pull requests and merges:

- For large or high-risk PRs, keep the PR branch history reviewable: use one meaningful commit per coherent feature, fix, test, docs update, or review-fix slice. Avoid hiding unrelated work behind a single local merge commit or vague "integration" commit.
- Before marking a large PR ready, replace WIP commits, accidental squash commits, or noisy merge commits on the PR branch with meaningful commits. Use `git push --force-with-lease` only on the PR branch after confirming no one else owns that branch.
- Always use squash merge when merging PRs to `main`.

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
gh pr merge <PR_NUMBER> --squash --auto
```

- Do not use regular merge or rebase merge; they create noisy history with intermediate commits.
- Once a PR is squash-merged, do not keep pushing follow-up commits from that branch. Start a fresh branch from updated `main`.

```bash
git checkout main
git pull origin main
git checkout -b fix/<short-description>
```

## Plans in Branches

- Design documents and implementation plans belong in `docs/plans/` inside the worktree so they are visible on the feature branch and in the draft PR.
- When working in a worktree, use paths relative to the worktree root such as `docs/plans/plan.md`. Do not prefix paths with the worktree directory itself.
- Plans are temporary working materials. Before merging the PR, delete the plan file and incorporate any user-relevant details into the official documentation.
