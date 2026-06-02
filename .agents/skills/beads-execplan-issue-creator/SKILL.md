---
name: beads-execplan-issue-creator
description: Optional; use only when the user/AO explicitly asks to convert an approved implementation plan or ExecPlan into dependency-aware Beads epics/issues for AgentV work.
---

# Beads ExecPlan Issue Creator

This is an optional Beads planning playbook. In AO-managed sessions, do not use it unless the user or AO explicitly assigns Beads planning. AO remains the live orchestration layer; GitHub remains the external collaboration record.

Convert one approved plan into high-quality Beads tracking in two passes:

1. Create epics and issues with explicit hierarchy and true blocker dependencies.
2. Review and polish the created graph so implementers can execute from fresh context with minimal ambiguity.

## Inputs

- `PLAN_FILE`: approved implementation plan path.
- `ROOT_EPIC_ID` optional: existing epic to attach work under.

If `ROOT_EPIC_ID` is omitted, create a root epic from the plan title and purpose.

## Rules

- Use `bd ... --json` for Beads operations only after explicit assignment.
- Do not create Beads as a parallel live tracker for AO-managed work.
- Do not invoke `ep-spawn-agent`, launch unmanaged agents, or create extra worktrees.
- Use `--dry-run` before large `bd create` bursts when the command supports it.
- Keep plan markdown as planning input; Beads can become durable backlog/planning context for the explicitly assigned Beads scope, but AO remains the live execution source of truth.
- Prefer fewer high-confidence beads over many vague beads.
- Ask for clarification when dependency edges or scope boundaries are ambiguous enough to risk incorrect work.
- Do not serialize independent work. Use dependencies only for true blockers.

## Parse The Plan

Extract:

- plan title and purpose;
- milestones or phases;
- concrete implementation steps;
- validation and acceptance criteria;
- interfaces, dependencies, and invariants;
- idempotence, recovery, and safety constraints;
- explicit non-goals.

## Build The Graph Before Creating

Model:

- root phase epic;
- child milestone epics when the plan has major phases;
- implementation issues under the relevant epic;
- blocker dependencies only where work cannot start without another bead;
- parallelization notes where independent tracks can run concurrently.

## Create Beads

Use clear descriptions. For epics, include:

```markdown
## Context
<why this epic exists>

## Success Criteria
- <verifiable outcome>

## Dependencies and Parallelization
- Blocked by: <ids or none>
- Can run in parallel with: <ids or none>
```

For tasks/features/chores/bugs, include:

```markdown
## Context
<why this work exists>

## Detailed Design
<technical approach and boundaries>

## Acceptance Criteria
- <observable behavior>

## Verification
- <command or explicit test path>

## Parallelization Notes
- Blocked by: <ids or none>
- Parallel with: <ids or none>

## Invariants
- <must remain true>
```

Command shape:

```bash
bd create "<title>" \
  --description "<well-structured description>" \
  -t epic|feature|task|chore|bug \
  -p 0-4 \
  --parent <optional-parent-id> \
  --deps discovered-from:<root-epic-id>[,<true-blocker-id>...] \
  --json
```

## Review And Polish Pass

After creation:

```bash
bd show <ROOT_EPIC_ID> --json
bd children <ROOT_EPIC_ID> --json
bd list --json
```

Check every created bead for:

- clear title with actor/outcome/scope;
- complete description sections;
- specific acceptance criteria;
- concrete verification commands;
- correct dependency direction;
- no accidental dependency cycles;
- no unnecessary serialization;
- enough context for a fresh worker to execute.

Polish with:

```bash
bd update <ID> --title "<better title>" --description "<polished description>" --json
bd dep add <ISSUE_ID> <BLOCKER_ID> --json
bd dep remove <ISSUE_ID> <BLOCKER_ID> --json
```

## Output

Return:

1. root epic ID;
2. created epics and tasks;
3. dependency summary;
4. parallel work lanes;
5. verification strategy;
6. any ambiguities or human decisions needed;
7. recommended first `bd ready --json --parent <ROOT_EPIC_ID>` command.
