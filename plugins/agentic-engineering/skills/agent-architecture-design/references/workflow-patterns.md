# Workflow Patterns by Framework

Patterns from reference frameworks for designing agent workflows, organized by agentic design pattern.

## OpenSpec (OPSX Conventions)

**Source:** [OpenSpec](https://github.com/Fission-AI/OpenSpec)

**Best for:** Autonomous Pipeline and Multi-Agent System

**Core concept:** Artifact-driven dependency graph. Commands chain through file existence, not sequential phases.

**Default workflow (spec-driven):**
```
/opsx:explore → /opsx:propose → /opsx:apply → /opsx:archive
```

**Expanded workflow:**
```
/opsx:new → /opsx:continue (×N) → /opsx:apply → /opsx:verify → /opsx:archive
```

**Key patterns:**
- **Artifact gates** — Each phase produces a file. Next phase checks file exists before starting.
- **Delta specs** — Changes are expressed as ADDED/MODIFIED/REMOVED operations on existing specs, not full rewrites.
- **Fast-forward** (`/opsx:ff`) — Generate all planning artifacts at once for clear-scope work.
- **Schema-configurable** — Workflow phases defined in `schema.yaml` as a DAG, not hardcoded.
- **Archive merges deltas** — Completed changes are merged back into main specs, keeping specs as source of truth.

**Artifact types:**
| Artifact | Purpose |
|---|---|
| `proposal.md` | WHAT and WHY (scope, non-goals, acceptance criteria) |
| `specs/*.md` | Behavior contracts with Given/When/Then scenarios |
| `design.md` | HOW (technical approach, decisions, risks) |
| `tasks.md` | Implementation checklist with checkboxes |
| `verify-report.md` | Verification results and traceability |

---

## Superpowers

**Source:** [Superpowers](https://github.com/obra/superpowers/)

**Best for:** Single-Agent Iterative Loop and Autonomous Pipeline

**Core concept:** Skills as workflow phases with hard gates and mandatory skill checks.

**Workflow phases:**
1. Brainstorming — Explore requirements before committing
2. Writing Plans — Task decomposition
3. Executing Plans / Subagent-Driven Development — Implementation
4. Test-Driven Development — RED-GREEN-REFACTOR during implementation
5. Requesting Code Review — Verification
6. Finishing a Development Branch — Completion

**Key patterns:**
- **`<HARD-GATE>`** — Synchronization points that prevent progression without explicit checks. Agent must verify conditions before proceeding.
- **The 1% Rule** — If there's even a 1% chance a skill applies, invoke it. Prevents agents from rationalizing past important steps.
- **`SUBAGENT-STOP`** — Prevents subagents from invoking full skill workflows when executing specific tasks.
- **Brainstorming before planning** — Always explore intent and requirements before committing to a plan.
- **Two-stage code review** — Spec compliance review then code quality review (not one combined review).

---

## Compound Engineering

**Source:** [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)

**Best for:** Autonomous Pipeline with learning loop

**Core concept:** Four-phase repeating cycle where learnings compound across iterations.

**Workflow:**
```
/ce:plan → /ce:work → /ce:review → /ce:compound → repeat
```

**Key patterns:**
- **Compounding loop** (`/ce:compound`) — After each cycle, document what worked and what didn't. Feed learnings into future planning. Each cycle gets easier.
- **Autonomous modes:**
  - `/lfg` (Let's Go) — Sequential full cycle
  - `/slfg` (Swarm LFG) — Parallel execution during review/testing
- **Multi-agent review** — Review phase dispatches multiple agents for parallel code review.
- **Knowledge accumulation** — Solutions documented in the compound phase become reusable patterns.

---

## Framework Selection by Design Pattern

| Agentic Design Pattern | Primary Framework | Secondary Framework |
|---|---|---|
| Single-Agent Iterative Loop | Superpowers (brainstorm → plan → TDD) | — |
| Autonomous Pipeline | OpenSpec (validate → propose → design → apply → verify) | Compound Engineering (learning loop) |
| Optimization Loop | Custom iteration loop (hypothesize → test → measure → decide) | — |
| Multi-Agent System | OpenSpec artifact gates + Superpowers hard gates | Compound Engineering (per-role learning) |

## Universal Patterns (All Architectures)

1. **Hard gates** — Check prerequisites before proceeding. Never silently skip.
2. **Artifact persistence** — Write phase outputs to disk, not just conversation context. Enables cross-session resumption.
3. **Workflow state metadata** — Track which phases are complete in a YAML file alongside artifacts.
4. **Error handling** — Standardize retry policy. Clear failure messages naming what to fix.
5. **Trivial escape hatch** — Document when it's OK to skip phases (small fixes, config changes).
6. **Artifact self-correction** — Downstream phases can fix factual errors in upstream artifacts, logged in a corrections section.
