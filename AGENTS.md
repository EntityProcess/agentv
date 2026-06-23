# AgentV Agent Guide

This file is the root index for repo-facing agent instructions. Read the linked `.agents/*.md` guide for the kind of work you are doing, and read [STRATEGY.md](STRATEGY.md) plus [ROADMAP.md](ROADMAP.md) before making product-boundary calls.

## Product Direction

AgentV aims to be the repo-native, workspace-native evaluation framework for AI agents.

- Repo-native evals: run against real repos, multi-repo workspaces, setup scripts, and existing harnesses.
- Zero-infra local to CI: keep the default path lightweight so the same eval contract works on a laptop and in CI.
- Portable run artifacts: treat run bundles, traces, and summaries as the source of truth for comparison, gating, and export.
- Adapter boundaries: integrate with Phoenix, Harbor, Opik, and provider-specific systems through narrow adapters instead of absorbing their concepts into core.
- AI-native extensibility: keep the core small and composable so engineers and coding agents can extend it with plugins, wrappers, and harness-specific glue.

Phoenix boundary after the 2026-06-20 product decision:

- AgentV-owned run bundles, traces, transcripts, datasets, experiments, indexes, and Git-backed artifacts are not exported or projected into Phoenix.
- The local Dashboard is the supported zero-infra inspection path for AgentV run, trace, and session artifacts.
- Phoenix may be referenced as UI inspiration and optional external trace infrastructure only when Codex, Arize, or another hook already emitted spans independently.
- Optional Phoenix integration is link-out correlation only through safe `external_trace` metadata and an `Open in Phoenix` URL when available.
- Dashboard must not require the `px` CLI at runtime or query Phoenix database tables directly.

Design guardrails:

- Prefer core primitives plus plugins or wrappers over new built-ins.
- Document composition patterns before inventing a new feature.
- Match industry-standard lowest-common-denominator contracts when possible.
- When designing AgentV contracts, check public reference standards such as Claude Skills, Vercel agent-eval, Hugging Face Datasets, and OpenInference before inventing AgentV-specific shapes. Use their shared lowest common denominator where it fits, and document any intentional divergence.
- Apply YAGNI aggressively and solve the current request with the smallest surface that works.
- Keep extensions non-breaking unless a same-week unreleased surface should be hard-corrected.
- Design for AI comprehension with self-describing modules, clear extension points, and no dead scaffolding.

Read the full rationale and examples in [.agents/product-boundary.md](.agents/product-boundary.md).

## Always-Read Rules

- Start every repo change with `git fetch origin` and `git status --short --branch`.
- Use `bun` for package and script operations.
- Use the operator-supplied tracker when present. Do not commit tracker runtime state, local coordination config, or other machine-local artifacts.
- Do not use `git stash` on shared checkouts. Stage explicit paths only, and never push directly to `main`.
- Every merge to `main` requires a GitHub pull request with passing GitHub Actions. Do not locally merge feature or integration branches into `main` as a substitute for opening a PR.
- Prefer the primary checkout only for small, clean, bounded work. Use a dedicated worktree from the latest `origin/main` for non-trivial, risky, long-running, or parallel changes.
- Non-trivial work needs a plan or task list. If the implementation surface starts to balloon, stop and re-plan.
- Large or high-risk PRs need meaningful, reviewable commits for each coherent change. Rewrite only the PR branch with `git push --force-with-lease` when needed to replace WIP or accidental squashed history before review.
- Manual red/green UAT is blocking before a branch is ready for review. GitHub Actions is the authoritative merge gate.
- For eval, experiment, provider, or grader changes, dogfood with a live agent target and a live grader target before calling the PR ready. Mock graders, dry-run, and deterministic-only smoke tests are useful plumbing checks, but they are not live dogfood.
- For browser or screenshot UAT, keep evidence out of the public repo and publish reviewable artifacts to an `agentv-private` evidence branch. See [.agents/verification.md](.agents/verification.md).
- Wire formats are `snake_case`; internal TypeScript is `camelCase`. Translate only at the boundary.
- In AgentV, a `project` holds runs, traces, and experiments; a `benchmark` is a curated eval suite. Do not collapse those terms.
- `artifact_pointers` are an offload indirection for large detached payload bytes, such as trace and transcript artifacts. Do not use them as the discovery path for ordinary per-case sidecars; expose those with explicit index/manifest path fields such as `metrics_path`.

## Repo Map

- `packages/core/`: evaluation engine, providers, grading, project registry, and the programmatic API.
- `packages/sdk/`: lightweight assertion SDK such as `defineAssertion` and `defineCodeGrader`.
- `apps/cli/`: published CLI surface for `agentv`.
- `apps/web/src/content/docs/`: public product and CLI docs on agentv.dev.
- `examples/`: examples that double as reference material and integration coverage.
- `docs/adr/`: durable product and architecture boundary decisions.
- `docs/plans/`: implementation plans and temporary design artifacts.
- `docs/solutions/`: documented fixes, decisions, and best practices, organized by category.
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
- Beads bootstrap or recovery questions: read [docs/runbooks/beads-worktree-recovery.md](docs/runbooks/beads-worktree-recovery.md).
- Dashboard, docs, CLI UX, or grader verification work: read [.agents/verification.md](.agents/verification.md).
- Wire-format, naming, or grader-type changes: read [.agents/conventions.md](.agents/conventions.md).
- Version bumps or npm publishing: read [.agents/publish.md](.agents/publish.md).
