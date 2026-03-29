---
name: hs-implement
description: >-
  Use when executing an implementation plan task-by-task, writing code with TDD
  discipline, dispatching subagents for independent tasks, or debugging failures.
  Triggers when asked to "implement the plan", "start coding", "write the code",
  "execute the tasks", or when a plan exists and implementation has not started.
---

# Implement

## Overview

Execute the plan task-by-task with TDD discipline. Dispatch subagents for independent tasks. Debug systematically when things break.

## Hard Gate

Must have a plan to execute. If no plan exists at `.agents/plans/*-plan.md` on the current branch, stop and tell the user to run hs-plan first. Exception: trivial changes (< 5 lines, docs, config) may proceed without a plan.

## TDD Protocol

For every task:

1. **Write the failing test first**
2. **Run it — must fail (red).** If it passes, the test is wrong or the feature already exists. Investigate.
3. **Write minimal implementation** to make the test pass
4. **Run it — must pass (green).** If it fails, debug (see Systematic Debugging below).
5. **Refactor** if needed — tests must still pass after refactoring
6. **Run full pre-commit checks:** build → test → lint
7. **Commit**

Before each commit, run the full pre-commit check chain. If the repo has pre-commit hooks, run them explicitly rather than discovering failures on push:

```bash
bun run build && bun run test && bun run lint
```

Adapt the commands to the repo's actual toolchain (read from CLAUDE.md/AGENTS.md/package.json).

## Subagent Dispatch

When 2+ tasks are independent with no shared state, dispatch them in parallel:

- **Fresh subagent per task** — no context pollution between tasks
- **Each subagent gets:** the plan, the specific task, and any relevant context files
- **Model selection:** use cheaper models for mechanical tasks (rename, move, format), capable models for judgment tasks (architecture, complex logic)

### Subagent Review Protocol

After each subagent completes, review in two stages:

1. **Spec compliance** — does the output match the plan's requirements?
2. **Code quality** — is the code clean, tested, and consistent with the codebase?

Load `references/spec-reviewer-prompt.md` and `references/code-quality-reviewer-prompt.md` for reviewer instructions.

### Subagent Status Handling

| Status | Action |
|---|---|
| DONE | Accept, move to next task |
| DONE_WITH_CONCERNS | Review concerns, fix if valid, accept if not |
| NEEDS_CONTEXT | Provide missing context, re-dispatch |
| BLOCKED | Investigate blocker, unblock or escalate to user |

## Systematic Debugging

When something breaks:

1. **Read the error** — the full error message, not just the first line
2. **Check assumptions** — is the file where you think it is? Is the function signature what you expect?
3. **Try a focused fix** — one change at a time, re-run after each
4. **Do not retry blindly** — if the same command fails twice, the problem is not transient
5. **Do not abandon a viable approach after one failure** — diagnose before switching tactics
6. **Escalate to user** only when genuinely stuck after investigation

**Iron law:** No fixes without root cause investigation first. "It might be X" is not a root cause. Read the code, trace the execution, find the actual cause.

## Skill Resources

- `references/implementer-prompt.md` — Subagent prompt template for implementation tasks
- `references/spec-reviewer-prompt.md` — Subagent prompt template for spec compliance review
- `references/code-quality-reviewer-prompt.md` — Subagent prompt template for code quality review
