---
name: beads-epic-delivery-loop
description: Use when executing a top-level Beads epic end-to-end for AgentV. Iterates unblocked tasks with claim, implement, test, review, commit, close, and repeat until completion or a hard stop condition.
---

# Beads Epic Delivery Loop

Execute a top-level epic by repeatedly selecting unblocked work, implementing only the selected scope, verifying, reviewing, committing, and closing tasks.

## Inputs

- `EPIC_ID` required: top-level epic to execute.
- `PLAN_FILE` optional but recommended: source plan with acceptance and architecture context.

## Required Rules

- Use `bd ... --json` for issue-tracking operations.
- Keep statuses accurate: `open` -> `in_progress` -> `closed`, or `blocked` with a clear reason.
- Do not work outside `EPIC_ID` and its descendants.
- Do not close a bead until acceptance criteria and verification are satisfied.
- Do not skip review before close.
- Stop on hard blockers instead of inventing scope.

## High-Level Loop

1. Read the epic and plan context.
2. Select the next incomplete unblocked sub-epic or task in deterministic order.
3. Claim and mark the selected task in progress.
4. Gather only the relevant task, dependency, plan, and repo context.
5. Implement the scoped slice.
6. Run task-specific verification first, then broader required checks.
7. Review against plan/spec and perform a code review pass.
8. Commit focused changes.
9. Push the branch and update or create the draft PR when appropriate.
10. Close the bead with a completion reason.
11. Repeat until the epic completes or a stop condition is reached.

## Deterministic Selection

Use creation order to break ties:

1. Load the epic:

   ```bash
   bd show <EPIC_ID> --json
   bd children <EPIC_ID> --json
   ```

2. Prefer incomplete unblocked sub-epics before direct top-level tasks.
3. Within the active scope, list children, filter to non-epic open tasks with satisfied dependencies, and pick the oldest.
4. If open tasks remain but none are executable, stop with `blocked_waiting_on_dependencies`.
5. If no open tasks remain in the active scope, mark the scope complete and advance.

## Task Execution Pattern

For each selected task:

```bash
bd update <TASK_ID> --claim --json
bd update <TASK_ID> --status in_progress --json
bd show <TASK_ID> --json
```

Then:

- implement only the scoped task;
- avoid opportunistic unrelated refactors;
- run verification named in the bead or plan;
- inspect changed files with `git diff`;
- fix deviations before committing;
- create a focused conventional commit;
- push the branch;
- update PR notes if a PR exists;
- close the bead after acceptance is met.

Close shape:

```bash
bd close <TASK_ID> --reason "Completed: <short evidence summary>" --json
```

## Discovery Handling

When discovering follow-up work:

```bash
bd create "<follow-up title>" \
  --description "<what was discovered, why it matters, and suggested next step>" \
  -t bug|feature|task|chore \
  -p 0-4 \
  --deps discovered-from:<TASK_ID> \
  --json
```

Keep the current task open if its declared acceptance criteria are not complete. Do not widen the current PR unless the follow-up is required for the selected task.

## Stop Conditions

Stop immediately on:

- blocked dependency or missing prerequisite;
- failing verification that cannot be resolved within the current task scope;
- unclear plan/spec that would make implementation unsafe;
- inconsistent Beads state preventing deterministic selection;
- merge conflicts or PR/CI failures that require separate focused work.

When stopping, leave a bead note:

```bash
bd note <TASK_ID> "Stopped: <reason>; current branch/worktree: <path>; next action: <action>"
bd dolt push
```

## Completion Output

Return one summary with:

1. epic ID and plan file;
2. tasks completed in order;
3. commits created;
4. PR URL or branch;
5. checks run and results;
6. new beads created from discoveries;
7. blocked tasks or stop reason;
8. next recommended action.
