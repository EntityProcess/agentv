# Agent Species Taxonomy

## Species A: The Coding Harness

**Use when:** Problem is software-shaped and scale is task-level.

**Architecture:**
- Human is the manager; agent is the worker
- Focus on decomposition — break the big problem into small, well-defined chunks
- Each chunk is independently implementable and testable

**Tooling requirements:**
- Terminal access (shell, build tools, test runners)
- File system access (read, write, search)
- Search tools (grep, glob, web search)
- Version control (git)

**Workflow:** Single-phase — decompose → implement → verify

**Management model:** Human as manager. Human defines what to build, agent builds it, human reviews.

**Example:** A developer using Claude Code to implement a feature. They describe what they want, Claude writes the code, developer reviews and iterates.

**Anti-patterns:**
- Using Species A for a project that needs 10+ coordinated agents
- No decomposition — giving the agent one massive task instead of focused chunks
- No verification step — trusting agent output without review

---

## Species B: The Dark Factory

**Use when:** Problem is software-shaped and high autonomy is required.

**Architecture:**
- Spec In → Autonomous Zone → Eval Out
- Human involvement is heavy at start (specs) and end (review), zero in the middle
- Iterations (v0.1 → v1.0) happen automatically until eval passes

**Requirements:**
- Robust evals are mandatory — the system cannot self-correct without them
- Specs must be precise enough to generate working systems
- Evals must be discriminating — pass for good output, fail for bad

**Workflow:** OpenSpec-style pipeline:
1. Validate (check requirements against reality)
2. Propose (define WHAT and WHY)
3. Design (plan HOW)
4. Implement (TDD through task checklist)
5. Verify (build + test + spec traceability)

**Management model:** Human as spec-writer. Human writes specs and reviews final output. Everything in between is autonomous.

**Example:** A spec-driven development plugin where the developer provides a work item number, and the system autonomously validates requirements, designs the implementation, codes it with TDD, and produces a PR.

**Anti-patterns:**
- No evals — the system has no way to know when it's done or if it's correct
- Specs too vague — "make it better" is not a spec
- Human intervening in the autonomous zone — defeats the purpose

---

## Species C: Auto Research

**Use when:** Problem is metric-shaped (optimization).

**Architecture:**
- Hill climbing against a specific metric
- Agent tries paths, fails, and backtracks
- Each iteration measures progress against the target

**Requirements:**
- Clear, measurable optimization target
- Fast feedback loop (metric must be computable quickly)
- Permission to explore and fail

**Workflow:** Iteration loop:
1. Hypothesize (propose a change)
2. Test (apply the change)
3. Measure (evaluate against metric)
4. Decide (advance if improved, backtrack if not)
5. Repeat until target reached or budget exhausted

**Management model:** Human as observer. Human defines the metric and constraints, agent explores the solution space.

**Example:** Optimizing a prompt's accuracy against an eval suite. Agent tries variations, measures pass rate, keeps improvements, discards regressions.

**Anti-patterns:**
- No clear metric — "make it better" is not optimizable
- Using for creative tasks — novels, designs, art have no single metric
- No backtracking — agent must be allowed to undo bad changes

---

## Species D: Orchestration Framework

**Use when:** Problem requires specialized roles and complex handoffs.

**Architecture:**
- Define specialized roles (Researcher → Writer → Editor → Publisher)
- Focus on handoffs — complexity lies in context management between agents
- Each role has its own tools, context, and success criteria

**Scale requirement:** Only justified when the volume warrants it. Managing 10,000 tickets needs orchestration. Managing 10 does not.

**Workflow:** Role pipeline with handoffs:
1. Role₁ performs its task, produces output artifact
2. Handoff: artifact + summary passed to Role₂
3. Role₂ performs its task, produces next artifact
4. Continue until pipeline complete

**Management model:** Human as observer or planner-manager. For large scale, a planner agent manages sub-agents while human observes.

**Context management:**
- Each handoff loses context — design artifacts to carry essential information
- Summaries at each handoff prevent context window overflow
- Shared state (files, databases) can bridge context gaps

**Example:** A content pipeline where a researcher gathers information, a writer produces a draft, an editor refines it, and a publisher formats and distributes it.

**Anti-patterns:**
- Over-engineering — using orchestration for a 3-step task one person could do
- Poor handoffs — losing critical context between agents
- No specialization — all agents doing the same thing (just use Species A)
- Too many management layers — 3-level hierarchies are almost always slower than 2-level

---

## Species Selection Decision Tree

```
Is the goal working software or optimizing a metric?
├── Software-shaped
│   ├── Single discrete task? → Species A (Coding Harness)
│   ├── Needs full autonomy (spec → code → eval)? → Species B (Dark Factory)
│   └── Multiple specialized roles needed at scale? → Species D (Orchestration)
└── Metric-shaped
    ├── Single metric to optimize? → Species C (Auto Research)
    └── Multiple metrics across coordinated roles? → Species C + D (Hybrid)
```

## Hybrid Architectures

Real systems often combine species:

- **B + C:** Dark Factory with optimization loop (auto-iterate on prompts using eval scores)
- **A + D:** Individual coding harnesses orchestrated by a planner for large projects
- **B + D:** Autonomous pipeline with specialized roles (validate-agent, design-agent, code-agent)

When combining, keep the management model simple. A 2-level structure (planner + workers) outperforms deeper hierarchies.
