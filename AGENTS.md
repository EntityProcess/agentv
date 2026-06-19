# AgentV Agent Guide

This file is the root index for repo-facing agent instructions. Read the linked `.agents/*.md` guide for the kind of work you are doing, and read [STRATEGY.md](STRATEGY.md) plus [ROADMAP.md](ROADMAP.md) before making product-boundary calls.

## Product Direction

AgentV aims to be the repo-native, workspace-native evaluation framework for AI agents.

- Repo-native evals: run against real repos, multi-repo workspaces, setup scripts, and existing harnesses.
- Zero-infra local to CI: keep the default path lightweight so the same eval contract works on a laptop and in CI.
- Portable run artifacts: treat run bundles, traces, and summaries as the source of truth for comparison, gating, and export.
- Adapter boundaries: integrate with Phoenix, Harbor, Opik, and provider-specific systems through narrow adapters instead of absorbing their concepts into core.
- AI-native extensibility: keep the core small and composable so engineers and coding agents can extend it with plugins, wrappers, and harness-specific glue.

Design guardrails:

- Prefer core primitives plus plugins or wrappers over new built-ins.
- Document composition patterns before inventing a new feature.
- Match industry-standard lowest-common-denominator contracts when possible.
- Apply YAGNI aggressively and solve the current request with the smallest surface that works.
- Keep extensions non-breaking unless a same-week unreleased surface should be hard-corrected.
- Design for AI comprehension with self-describing modules, clear extension points, and no dead scaffolding.

Read the full rationale and examples in [.agents/product-boundary.md](.agents/product-boundary.md).

## Always-Read Rules

- Start every repo change with `git fetch origin` and `git status --short --branch`.
- Use `bun` for package and script operations.
- Use the operator-supplied tracker when present. Do not commit tracker runtime state, local coordination config, or other machine-local artifacts.
- Do not use `git stash` on shared checkouts. Stage explicit paths only, and never push directly to `main`.
- Prefer the primary checkout only for small, clean, bounded work. Use a dedicated worktree from the latest `origin/main` for non-trivial, risky, long-running, or parallel changes.
- Non-trivial work needs a plan or task list. If the implementation surface starts to balloon, stop and re-plan.
- Manual red/green UAT is blocking before a branch is ready for review. GitHub Actions is the authoritative merge gate.
- Wire formats are `snake_case`; internal TypeScript is `camelCase`. Translate only at the boundary.
- In AgentV, a `project` holds runs, traces, and experiments; a `benchmark` is a curated eval suite. Do not collapse those terms.

## Repo Map

- `packages/core/`: evaluation engine, providers, grading, project registry, and the programmatic API.
- `packages/eval/`: lightweight assertion SDK such as `defineAssertion` and `defineCodeGrader`.
- `apps/cli/`: published CLI surface for `agentv`.
- `apps/web/src/content/docs/`: public product and CLI docs on agentv.dev.
- `examples/`: examples that double as reference material and integration coverage.
- `docs/adr/`: durable product and architecture boundary decisions.
- `docs/plans/`: implementation plans and temporary design artifacts.
- `docs/learnings/`: primary learning store for captured fixes and decisions.
- `CONCEPTS.md`: shared domain vocabulary.

## Routing

Read the relevant guide before specialized work:

- [.agents/product-boundary.md](.agents/product-boundary.md): full goals, design principles, AI-first guidance, and how to decide core vs plugin vs docs.
- [.agents/workflow.md](.agents/workflow.md): tracker handling, worktrees, planning, execution, git workflow, PR flow, and documentation update expectations.
- [.agents/verification.md](.agents/verification.md): CI gates, CLI and browser E2E, grader verification, concurrency limits, and the completion checklist.
- [.agents/conventions.md](.agents/conventions.md): TypeScript and Bun conventions, subprocess rules, naming contracts, wire formats, grader type rules, and Python script usage.
- [.agents/publish.md](.agents/publish.md): versioning, publish workflow, contract gates, and published package surfaces.

Common entry points:

- Product or architecture decisions: start with [STRATEGY.md](STRATEGY.md), [ROADMAP.md](ROADMAP.md), and [.agents/product-boundary.md](.agents/product-boundary.md).
- Tracker, worktree, or PR flow questions: read [.agents/workflow.md](.agents/workflow.md).
- Dashboard, docs, CLI UX, or grader verification work: read [.agents/verification.md](.agents/verification.md).
- Wire-format, naming, or grader-type changes: read [.agents/conventions.md](.agents/conventions.md).
- Version bumps or npm publishing: read [.agents/publish.md](.agents/publish.md).
