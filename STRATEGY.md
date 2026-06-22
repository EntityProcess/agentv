---
name: AgentV
last_updated: 2026-06-21
---

# AgentV Strategy

## Target problem

Teams evaluating coding agents and other tool-using workflows need results from the real repositories, fixtures, and harnesses their agents already touch, but that work often gets split away from the actual workspace and development loop it came from. That makes it hard to reproduce failures, compare targets fairly, and keep evaluation evidence close to the code and workflow it came from.

## Our approach

AgentV stays repo-native and workspace-native: it runs or imports evaluations around the user's existing harness, writes portable run artifacts, and keeps core primitives focused on execution, grading, routing, and results storage. It integrates outward through clear boundaries: Phoenix can be correlated with as an optional external trace database when spans were emitted independently, Harbor can provide benchmark-grade execution, and post-run/export adapters can serve adjacent systems without AgentV trying to own every layer.

## Who it's for

**Primary:** AI platform engineers and agent builders working in real repositories. They're hiring AgentV to evaluate real agent workflows, compare targets, and gate changes using the same workspaces, fixtures, and result artifacts their teams already rely on.

## Key metrics

- **Repo-native eval success** - Share of dogfood and example eval flows that run against real workspaces, hooks, repo materialization, or imported artifacts without extra infrastructure; measured by CI and manual UAT on canonical suites.
- **Time to inspect a run** - Time from completed `agentv eval` to usable local review, compare, or report output from the canonical run bundle; measured through CLI and Dashboard/report workflows.
- **Artifact portability coverage** - Share of integrations and follow-on workflows that consume `index.jsonl`, `benchmark.json`, trace sidecars, or imported run bundles instead of bespoke stores; measured by adapter smoke tests, docs, and example coverage.
- **Git-backed results reliability** - Success rate for publish, sync, resume, and WIP checkpoint flows across local branches and dedicated results repos; measured by integration tests and manual end-to-end verification.

## Tracks

### Workspace-native evaluation

Make real repository workflows first-class: repo acquisition, hooks, pooled workspaces, replay/import paths, and reuse of existing harnesses.

_Why it serves the approach:_ This keeps AgentV attached to the actual work the agent is being judged on instead of collapsing it into a synthetic runner.

### Portable run artifacts

Keep the run bundle, trace sidecars, and git-backed results model as the canonical exchange surface for inspection, sharing, and automation.

_Why it serves the approach:_ Portable artifacts let local runs, CI, static reports, and downstream adapters all share one source of truth.

### Adapter-led integrations

Add Phoenix, Harbor, Opik, Langfuse, and similar systems through narrow correlation, runner, adapter, or export boundaries rather than copying their product models into core. For Phoenix specifically, the supported boundary is link-out correlation from safe `external_trace` metadata; AgentV does not read through, export, or project completed runs, traces, transcripts, datasets, experiments, or indexes into Phoenix.

_Why it serves the approach:_ This expands AgentV's reach without turning it into a hosted observability stack, benchmark platform, or integration kitchen sink.

### Evaluation primitives for real agent workflows

Strengthen provider routing, grader composition, trace and trajectory scoring, and CI gates around coding-agent and tool-using workflows.

_Why it serves the approach:_ The product wins when the core primitives make real agent evaluation easier to compose, not when it accumulates adjacent platform features.

## Not working on

- Rebuilding Phoenix, Opik, Langfuse, or similar experiment and trace UIs inside AgentV.
- Exporting or projecting AgentV-owned completed runs, traces, transcripts, datasets, experiments, or indexes into Phoenix.
- Making Phoenix, the `px` CLI, or Phoenix database tables part of the zero-infra local Dashboard path.
- Owning Harbor's benchmark packaging, verifier images, or suite-specific runtime contracts inside AgentV core.
- Expanding AgentV into a generic benchmark catalog or a general-purpose dashboard platform when repo-native evals, static artifacts, and adapters already cover the job.
