---
name: agent-architecture-design
description: >-
  Use when designing an AI agent system, selecting agent architecture,
  planning multi-phase workflows, choosing between single-agent and multi-agent patterns,
  or when asked "what kind of agent should I build", "how should I structure this automation",
  "design an agent for X", or "which agent pattern fits this problem".
---

# Agent Architecture Design

## Overview

Guide the selection and design of the correct AI agent architecture by diagnosing the problem type, mapping it to a proven species, and defining the workflow structure, tooling, and management model.

## Process

### Phase 1: Problem Diagnosis

Categorize the request on two axes:

| | Task-Level (single job) | Project-Level (coordination needed) |
|---|---|---|
| **Software-Shaped** (working code/system) | Species A | Species B or D |
| **Metric-Shaped** (optimize a number) | Species C | Species C + D |

**Diagnosis questions:**
1. Is the goal working software or optimizing a metric?
2. Is this a single discrete task or multiple coordinated parts?
3. How much human involvement is acceptable during execution?
4. What scale justifies the architecture complexity?

### Phase 2: Species Selection

Load `references/species-taxonomy.md` for full details on each species. Summary:

**Species A — Coding Harness**
- Human = manager, Agent = worker
- Decompose the problem into small chunks (UI, API, tests)
- Agent gets a workspace (terminal, files, search)
- Best for: individual developer productivity on discrete tasks

**Species B — Dark Factory**
- Spec In → Autonomous Zone → Eval Out
- Heavy human involvement at start (specs) and end (review), zero in the middle
- Requires robust evals — iterations happen automatically until eval passes
- Best for: zero-human-intervention production pipelines

**Species C — Auto Research**
- Hill climbing against a specific metric
- Agent tries paths, fails, backtracks
- Needs a clear optimization target
- Best for: reaching peak of an optimization metric through experimentation

**Species D — Orchestration Framework**
- Specialized roles with defined handoffs (Researcher → Writer → Editor → Publisher)
- Complexity lies in context management between agents
- Only justified at scale (10,000 tickets, not 10)
- Best for: seamless coordination across specialized AI workers

### Phase 3: Workflow Architecture

After selecting a species, define the workflow structure. Load `references/workflow-patterns.md` for framework-specific patterns.

**For each species, define:**

1. **Phases** — What sequential or parallel steps does the workflow execute?
2. **Artifacts** — What does each phase produce? (specs, designs, tasks, code, reports)
3. **Gates** — What must be true before proceeding to the next phase?
4. **Tooling** — What tools/MCPs does each agent need?
5. **Context flow** — How is information passed between phases/agents?
6. **Resumption** — How does the workflow recover from interruption?

**Species → Workflow mapping:**

| Species | Typical Workflow Pattern |
|---|---|
| A (Coding Harness) | Single-phase: decompose → implement → verify |
| B (Dark Factory) | OpenSpec-style: validate → propose → design → implement → verify |
| C (Auto Research) | Iteration loop: hypothesize → test → measure → backtrack/advance |
| D (Orchestration) | Role pipeline: role₁ → handoff → role₂ → handoff → roleₙ |

### Phase 4: Output

Produce a design document covering:

1. **Diagnosis** — Software or metric shaped, task or project level
2. **Recommended Species** — Which architecture and why
3. **Workflow Design** — Phases, artifacts, gates, context flow
4. **Scaffolding Plan** — Tools, MCPs, evals the agent needs
5. **Management Model** — Human role (Manager, Observer, or Spec-Writer)

## Implementation Rules

1. **Simple scales better** — Do not recommend 3-level management if 2-level works. Simple configurations are more performant.
2. **Context is everything** — Agents depend entirely on the context and scaffolding provided by the architect. Design the scaffolding, not just the agent.
3. **Human-centered → Agent-centered** — For large projects, move from "human managing every agent" to "planner agent managing sub-agents" where the human observes.
4. **Avoid type-confusion** — Never use Auto Research to build a novel. Never use a single Coding Harness for a project requiring specialized orchestration roles.
5. **Scale justifies complexity** — Multi-agent orchestration is only worth it at scale. For small problems, a single well-prompted agent outperforms a complex framework.

## Skill Resources

- `references/species-taxonomy.md` — Detailed species descriptions with examples and anti-patterns
- `references/workflow-patterns.md` — Workflow patterns from OpenSpec, Superpowers, and Compound Engineering

## Related Skills

- **agent-plugin-review** — Review an implemented plugin against architecture best practices
