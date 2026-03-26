# Workflow Architecture Checklist

Review multi-phase plugin workflows against these patterns, derived from [OpenSpec](https://github.com/Fission-AI/OpenSpec) (OPSX conventions), [Superpowers](https://github.com/obra/superpowers/), and [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin).

## Phase Coverage

Compare the plugin's workflow phases against the OpenSpec artifact model:

| OpenSpec Phase | OPSX Command | Expected Plugin Equivalent |
|---|---|---|
| Explore | `/opsx:explore` | Research mode — investigate without creating artifacts |
| Validate | (custom) | Check requirements against real codebase before design |
| Propose | `/opsx:propose` | Define WHAT and WHY with acceptance criteria |
| Design | (via schema) | Plan HOW — file-level changes, multi-repo coordination |
| Tasks | (via schema) | Standalone `tasks.md` with `- [ ]` checkboxes |
| Apply | `/opsx:apply` | Implement through task checklist with TDD |
| Verify | `/opsx:verify` | Build + test + trace implementation back to specs |
| Archive | `/opsx:archive` | Finalize, merge deltas, persist learnings |

Not all phases are required for every plugin. Flag missing phases only when the gap would cause real problems.

## Hard Gates

From [Superpowers](https://github.com/obra/superpowers/) `<HARD-GATE>` pattern:

- [ ] Each phase checks for prerequisite artifacts before proceeding
- [ ] Gate failure message tells the user which command/skill to run first
- [ ] Gates cannot be silently bypassed
- [ ] Gate checks happen at the start of the skill, before any work

**How to detect missing hard gates:** For each phase skill beyond the first, read the SKILL.md and check whether it verifies the previous phase's output artifact exists (e.g., `deploy-plan.md`, `design.md`) before starting work. If a skill jumps straight into execution without checking prerequisites, it is missing a hard gate.

Example gate:
```
HARD GATE: `deploy-plan.md` MUST exist in {output_dir}/.
If missing, inform the user: "Run the deploy-plan skill first to generate a deployment plan." STOP.
```

## Artifact Contracts

- [ ] Each phase produces a defined output artifact (e.g., `context.md`, `design.md`, `tasks.md`)
- [ ] Output format of phase N matches expected input of phase N+1
- [ ] Artifact location convention is defined (not just `{output_dir}/`)
- [ ] Artifacts persist to disk (not just conversation context) for cross-session resumption

## Workflow State

- [ ] Workflow state tracked in a metadata file (e.g., `.workflow.yaml`) alongside artifacts
- [ ] Metadata records: which phases are complete, timestamps, WI/issue number
- [ ] Resumption protocol detects existing artifacts and skips completed phases
- [ ] Partial completion is handled (e.g., Phase 4 with N-1 of N agents succeeding)

## Error Handling

- [ ] Standardized retry policy across all skills (e.g., retry MCP calls 3x with exponential backoff)
- [ ] Clear failure reporting — user knows what failed and what to do next
- [ ] Errors don't silently corrupt downstream phases
- [ ] Critical failures (P0 findings, merge conflicts) stop the workflow

## Escape Hatches

- [ ] Trivial change escape: small fixes can skip spec phases
- [ ] Criteria for "trivial" are documented (e.g., < 20 lines, single file, no schema change)
- [ ] Artifact self-correction: downstream phases can fix factual errors in upstream artifacts
- [ ] Corrections are logged (e.g., `## Corrections Log` section) for auditability

## Learning Loop

From [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) `/ce:compound` pattern:

- [ ] Mechanism exists to capture patterns from completed work
- [ ] Learnings feed back into future workflow runs (e.g., review guidelines, common patterns)
- [ ] Learning artifacts are version-controlled and mergeable

## Fast-Forward Mode

From OpenSpec `/opsx:ff`:

- [ ] For well-understood changes, all planning artifacts can be generated in one pass
- [ ] Fast-forward mode is optional — users can still step through phases individually
