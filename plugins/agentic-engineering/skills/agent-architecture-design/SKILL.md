---
name: agent-architecture-design
description: >-
  Use when designing an AI agent system, selecting agentic design patterns,
  planning multi-phase workflows, choosing between single-agent and multi-agent architectures,
  or when asked "what kind of agent should I build", "how should I structure this automation",
  "design an agent for X", or "which agentic pattern fits this problem".
---

# Agent Architecture Design

## Overview

Guide the selection and design of the correct agentic architecture by diagnosing the problem type, mapping it to a proven design pattern, and defining the workflow structure, tooling, and management model.

## Process

### Phase 1: Problem Diagnosis

Categorize the request on two axes:

| | Task-Level (single job) | Project-Level (coordination needed) |
|---|---|---|
| **Software-Shaped** (working code/system) | Single-Agent Iterative Loop | Autonomous Pipeline or Multi-Agent System |
| **Metric-Shaped** (optimize a number) | Optimization Loop | Optimization Loop + Multi-Agent System |

**Diagnosis questions:**
1. Is the goal working software or optimizing a metric?
2. Is this a single discrete task or multiple coordinated parts?
3. How much human involvement is acceptable during execution?
4. What scale justifies the architecture complexity?

### Phase 2: Pattern Selection

Load `references/agentic-design-patterns.md` for full details on each pattern. Summary:

**Single-Agent Iterative Loop** (Agentic IDE)
- Human = manager, Agent = worker
- Decompose the problem into small chunks (UI, API, tests)
- Agent gets a workspace (terminal, files, search)
- Best for: individual developer productivity on discrete tasks

**Autonomous Pipeline** (Zero-Human Loop)
- Spec In → Autonomous Zone → Eval Out
- Heavy human involvement at start (specs) and end (review), zero in the middle
- Requires robust evals — iterations happen automatically until eval passes
- Best for: zero-human-intervention software delivery

**Optimization Loop** (Self-Improving Agent)
- Hill climbing against a specific metric
- Agent tries paths, fails, backtracks
- Needs a clear optimization target
- Best for: reaching peak of an optimization metric through experimentation

**Multi-Agent System** (Hierarchical/Supervisor Pattern)
- Specialized roles with defined handoffs (Researcher → Writer → Editor → Publisher)
- Complexity lies in context management between agents
- Only justified at scale (10,000 tickets, not 10)
- Best for: seamless coordination across specialized AI workers

### Phase 3: Workflow Architecture

After selecting a pattern, define the workflow structure. Load `references/workflow-patterns.md` for framework-specific patterns.

**For each pattern, define:**

1. **Phases** — What sequential or parallel steps does the workflow execute?
2. **Artifacts** — What does each phase produce? (specs, designs, tasks, code, reports)
3. **Gates** — What must be true before proceeding to the next phase?
4. **Tooling** — What tools/MCPs does each agent need?
5. **Context flow** — How is information passed between phases/agents?
6. **Resumption** — How does the workflow recover from interruption?

**Pattern → Workflow mapping:**

| Agentic Design Pattern | Typical Workflow |
|---|---|
| Single-Agent Iterative Loop | Single-phase: decompose → implement → verify |
| Autonomous Pipeline | OpenSpec-style: validate → propose → design → implement → verify |
| Optimization Loop | Iteration loop: hypothesize → test → measure → backtrack/advance |
| Multi-Agent System | Role pipeline: role₁ → handoff → role₂ → handoff → roleₙ |

### Phase 4: Output

Produce a design document covering:

1. **Diagnosis** — Software or metric shaped, task or project level
2. **Recommended Pattern** — Which agentic architecture and why
3. **Workflow Design** — Phases, artifacts, gates, context flow
4. **Scaffolding Plan** — Tools, MCPs, evals the agent needs
5. **Management Model** — Human role (Manager, Observer, or Spec-Writer)

## Implementation Rules

1. **Simple scales better** — Do not recommend 3-level management if 2-level works. Simple configurations are more performant.
2. **Context is everything** — Agents depend entirely on the context and scaffolding provided by the architect. Design the scaffolding, not just the agent.
3. **Human-centered → Agent-centered** — For large projects, move from "human managing every agent" to "planner agent managing sub-agents" where the human observes.
4. **Avoid pattern-confusion** — Never use an Optimization Loop to build a novel. Never use a Single-Agent Loop for a project requiring specialized multi-agent orchestration.
5. **Scale justifies complexity** — Multi-agent orchestration is only worth it at scale. For small problems, a single well-prompted agent outperforms a complex framework.

## Skill Resources

- `references/agentic-design-patterns.md` — Detailed pattern descriptions with examples and anti-patterns
- `references/workflow-patterns.md` — Workflow patterns from OpenSpec, Superpowers, and Compound Engineering

## Related Skills

- **agent-plugin-review** — Review an implemented plugin against architecture best practices
