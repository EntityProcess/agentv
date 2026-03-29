---
name: hs-plan
description: >-
  Use when converting an approved design spec into an implementation plan, when the
  design is ready and you need step-by-step tasks with exact code and commands, or
  when asked to "write a plan", "break this into tasks", "create implementation steps",
  or "plan the implementation".
---

# Plan

## Overview

Convert an approved design into a bite-sized implementation plan with exact file paths, complete code, and test commands. Every step is a 2-5 minute task.

## Hard Gate

Must reference an approved design spec. If no spec exists at `.agents/plans/*-design.md` on the current branch, stop and tell the user to run hs-design first.

## Process

### Step 1: Plan header

Start the plan with:

```markdown
# Implementation Plan: <topic>

**Design spec:** `.agents/plans/YYYY-MM-DD-<topic>-design.md`
**Goal:** <one-line summary>
**Architecture:** <key technical decisions>
**Tech stack:** <languages, frameworks, tools>
```

### Step 2: Enumerate all consumers

When modifying a shared function, type, or interface: grep for all import sites and call sites. Every consumer must appear in the plan as a file to modify. Missing a consumer is a guaranteed bug.

### Step 3: Define tasks

Each task is a 2-5 minute step following TDD:

```markdown
## Task N: <description>

**Files:** `path/to/file.ts` (modify), `path/to/file.test.ts` (create)

### Test
\`\`\`typescript
// Exact test code
\`\`\`

### Run
\`\`\`bash
bun run test -- path/to/file.test.ts
\`\`\`

### Expected: FAIL (function does not exist yet)

### Implementation
\`\`\`typescript
// Exact implementation code
\`\`\`

### Run
\`\`\`bash
bun run test -- path/to/file.test.ts
\`\`\`

### Expected: PASS

### Commit
\`\`\`bash
git add path/to/file.ts path/to/file.test.ts
git commit -m "feat(scope): add <description>"
\`\`\`
```

### Step 4: Self-review checklist

Before presenting the plan:

- [ ] Every file in the design spec has a corresponding task
- [ ] Every consumer of modified interfaces has a task
- [ ] No placeholders ("TBD", "implement later", "similar to Task N")
- [ ] Every task has actual code, not pseudocode
- [ ] Every task has exact commands with expected output
- [ ] Tasks are ordered by dependency (tests before implementation)
- [ ] Types are consistent across all tasks

### Step 5: Save plan

Save to the worktree branch:

```
.agents/plans/YYYY-MM-DD-<topic>-plan.md
```

## Plan Quality Rules

- **No placeholders** — every task has real code
- **No hand-waving** — "similar to Task N" is not a task
- **DRY** — if two tasks touch the same file, consider merging
- **YAGNI** — do not plan tasks for hypothetical future requirements
- **Frequent commits** — each task ends with a commit
- **TDD order** — write test, run it (red), implement, run it (green), commit
