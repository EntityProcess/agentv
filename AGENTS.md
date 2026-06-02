# AgentV Repository Guidelines

This is a TypeScript monorepo for AgentV, an AI agent evaluation framework.

## Load Skills First

Keep this file as bootstrap context. Detailed AgentV playbooks live in committed skills under `.agents/skills/`, following the Phoenix-style repo skill layout. `.claude/skills` is a symlink to the same directory for Claude compatibility.

Before non-trivial work, load the relevant skill:

- `agentv-core-development`: core design principles, TypeScript conventions, naming, snake_case wire formats, docs, examples, and repo structure.
- `agentv-testing-verification`: CLI testing, Studio/browser verification, grader e2e checks, pre-push hooks, and PR readiness evidence.
- `agentv-git-workflow`: AO-first session/worktree/PR lifecycle, GitHub collaboration, pushing, merging, and cleanup.
- `beads-execplan-issue-creator`: optional, only when the user/AO explicitly assigns Beads planning; convert approved ExecPlans into dependency-aware bead epics/tasks.
- `beads-epic-delivery-loop`: optional, only when the user/AO explicitly assigns Beads execution; execute a bead epic without spawning unmanaged agents.
- `agentv-grader-changes`: grader/evaluator type changes, score output, baselines, live eval verification, and score-range checks.
- `agentv-release-publishing`: versioning, release automation, and package publishing.

## Always-On Rules

- Use Bun for all package and script operations.
- Run Python scripts with `uv run <script.py>`.
- Internal TypeScript uses `camelCase`; anything crossing a process boundary uses `snake_case`. Translate at the boundary.
- Keep AgentV core lightweight. Prefer existing primitives, plugins, examples, and docs over new built-ins.
- Do not use global `agentv` for CLI testing. Use `bun apps/cli/src/cli.ts <args>`; rebuild first when `packages/core/` changes.
- For Studio UI verification, rebuild `apps/studio/dist/` before UAT or screenshots.
- In AO-managed sessions, use the AO-provided worktree/session/PR lifecycle. Do not create a second worktree, session, tracker, or PR unless AO/user explicitly asks.
- Outside AO, use a fresh sibling worktree under `../agentv.worktrees/` based on latest `origin/main` for non-trivial repo changes.
- Never push directly to `main`. Push feature branches and open/update PRs.
- Use conventional commit and PR titles: `type(scope): summary`.
- Do not create competing task trackers or memory files. AO is the orchestration layer for live work; GitHub is the external collaboration record. Use Beads only when explicitly assigned.

## Safety Guardrails

- The user is in charge. If an explicit user instruction conflicts with repo habits, follow the user unless it would be unsafe or impossible.
- Do not delete files or folders without explicit permission. This includes temporary files you created unless the user already approved that cleanup.
- Never run destructive cleanup/reset commands such as `git reset --hard`, `git clean -fd`, or broad `rm -rf` unless the user gives the exact command and explicitly confirms the irreversible consequences.
- Prefer non-destructive recovery: inspect with `git status` / `git diff`, move aside, stash, or ask before overwriting work.
- Do not push directly to `main`; all code changes land through branches and PRs.

## Key Paths

- `packages/core/`: evaluation engine, providers, grading, registry, programmatic API.
- `packages/eval/`: lightweight assertion SDK.
- `apps/cli/`: CLI published as `agentv`.
- `apps/studio/`: Studio frontend.
- `apps/web/`: documentation site.
- `examples/`: documentation and integration coverage.
- `.agents/skills/`: committed coding-agent skills.

## Orchestration and Tracking

AO (Composio Agent Orchestrator) is AgentV's orchestration layer for live coding work. In an AO-managed session:

- Treat the AO session as the source of truth for assignment, status, worker ownership, worktree lifecycle, PR claiming, and visualization.
- Report progress with `ao acknowledge`, `ao report working`, `ao report fixing-ci`, `ao report addressing-reviews`, `ao report needs-input`, and PR milestone reports as appropriate.
- When taking over an existing PR, run `ao session claim-pr <number-or-url>` first. If AO or git shows another session/worktree owns it, coordinate instead of forcing checkout or creating a duplicate PR.
- Do not spawn unmanaged coding agents, invoke `ep-spawn-agent`, create ad-hoc worktrees, or maintain a parallel live task tracker unless AO/user explicitly delegates that work.
- GitHub remains the external collaboration surface for PRs, reviews, CI, issues, and human-visible handoff.
- Beads (`bd`) may exist for durable planning or backlog records, but it is not the routine live execution tracker in AO-managed sessions. Use it only when explicitly assigned, and never let Beads state override AO session/PR ownership.

Outside AO, follow the repo git workflow skill for manual worktree and PR handling.
