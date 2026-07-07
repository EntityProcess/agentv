# AgentV Agent Guide

This file is the root index for repo-facing agent instructions. It carries baseline rules that always apply plus a [Routing](#routing) table that maps your change to the deeper `.agents/*.md` guide you must read **before** starting that work. The rules in this file are a summary; each linked guide is authoritative for its area, so a matching Routing trigger means "read the guide," not "the summary is enough." Read [STRATEGY.md](STRATEGY.md) plus [ROADMAP.md](ROADMAP.md) before making product-boundary calls.

## Product Direction

AgentV aims to be the repo-native, workspace-native evaluation framework for AI agents.

- Repo-native evals: run against real repos, multi-repo workspaces, setup scripts, and existing harnesses.
- Zero-infra local to CI: keep the default path lightweight so the same eval contract works on a laptop and in CI.
- Portable run artifacts: treat run bundles, traces, and summaries as the source of truth for comparison, gating, and export.
- Adapter boundaries: integrate with Phoenix, Harbor, Opik, and provider-specific systems through narrow adapters instead of absorbing their concepts into core.
- AI-native extensibility: keep the core small and composable so engineers and coding agents can extend it with plugins, wrappers, and harness-specific glue.

Eval authoring mental model:

- AgentV adopts Promptfoo-compatible matrix authoring by default: an eval expands `prompts x tests/vars x providers`, then applies repeat samples/retries as run policy.
- Author systems under test as `providers`. A provider entry `id` names the backend/spec string; `label` is the stable AgentV selection and result identity. `id` may contain Promptfoo-style colons such as `openai:responses:gpt-5.4`.
- The intended authored-config differences from Promptfoo are limited to `environment`, AgentV refs, and built-in AgentV providers such as `agentv:codex-cli`. Full Promptfoo compatibility for those AgentV-native pieces is by `agentv export promptfoo`.
- Use `environment` recipes for coding-agent testbeds, including host/Docker setup, repo materialization, fixtures, services, and cwd. Promptfoo export may lower a host/filesystem subset into generated `extensions` plus provider workdir configuration; Docker environments must remain unsupported on export until a faithful runner boundary exists. Do not use Promptfoo `extensions` or public `workspace` authoring as the canonical AgentV testbed contract.
- Use top-level `env` for provider/eval environment variables. Use `extensions` for lifecycle hooks. Use field-local `file://` refs for reusable prompts, tests, defaults, and environments; export may rewrite supported AgentV refs into Promptfoo-readable files.
- Use `tags` and run-bundle metadata for grouping and Dashboard navigation. Do not use experiment path buckets, Vercel path layout, or model-as-experiment grouping as canonical AgentV semantics.
- AgentV run bundles, traces, transcripts, datasets, indexes, and Git-backed artifacts stay AgentV-owned. Do not design an Opik export path or Phoenix projection path for them; Phoenix correlation is link-out only when `external_trace` metadata already exists.

Concrete matrix example:

```yaml
prompts:
  - file://prompts/fix-bug.md
  - file://prompts/add-test.md

tests:
  - vars:
      issue: "Repair the failing parser case"
      repo: "file://fixtures/parser"
    assert:
      - type: llm-rubric
        value: "The answer identifies the parser bug and includes a test."
  - vars:
      issue: "Explain the flaky retry behavior"
      repo: "file://fixtures/retry"

providers:
  - id: agentv:codex-cli
    label: codex-host
    runtime: host
    config:
      command: codex
  - id: anthropic:claude-agent-sdk
    label: claude

environment: file://.agentv/environments/local-repo.yaml
tags:
  experiment: prompt-compare
```

This produces eight authored provider-case executions before repeat policy: 2 prompts x 2 `tests[].vars` cases x 2 providers.

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
- Treat peer frameworks as evidence, not schema authority. Do not inherit baggage such as overloaded field names, compatibility aliases, or framework-specific historical constraints when AgentV can express a cleaner repo-native contract. For the provider surface, AgentV intentionally follows Promptfoo's `providers`/`id`/`label` shape so the uncommon AgentV differences stay concentrated in `environment`, refs, built-in AgentV providers, artifacts, and Dashboard behavior.
- For peer-framework research, use local cloned repositories and DeepWiki MCP before broad web search. In this operator workspace, Promptfoo is cloned at `/home/entity/projects/promptfoo/promptfoo` and DeepEval is cloned at `/home/entity/projects/confident-ai/deepeval`; use DeepWiki repos `promptfoo/promptfoo` and `confident-ai/deepeval` for architecture-level orientation, then verify exact claims with `rg` and `git` in the local clone. If a public contract must be checked for currentness, use official docs and record the source URL or clone commit behind the conclusion.
- Apply YAGNI aggressively and solve the current request with the smallest surface that works.
- Keep extensions non-breaking unless a same-week unreleased surface should be hard-corrected.
- Design for AI comprehension with self-describing modules, clear extension points, and no dead scaffolding.

Read the full rationale and examples in [.agents/product-boundary.md](.agents/product-boundary.md).

## Always-Read Rules

These baseline rules apply to every repo change. They summarize the most common cases; when your change matches a [Routing](#routing) trigger, the linked guide is authoritative and required reading before you start — do not treat these bullets as a substitute for it.

- Start every repo change with `git fetch origin` and `git status --short --branch`.
- Use `bun` for package and script operations.
- Use the operator-supplied tracker when present. Do not commit tracker runtime state, local coordination config, or other machine-local artifacts.
- When Beads are available, treat Beads as the worker-facing source of truth for task scope. Write each Bead description, acceptance criteria, and notes so a worker can execute from the Bead plus required AGENTS routing docs; do not require workers to read a merged or stale plan to discover the current decision. If a plan, PR comment, chat decision, or ADR supersedes earlier guidance, update the Bead before dispatching or continuing work.
- Do not use `git stash` on shared checkouts. Stage explicit paths only, and never push directly to `main`.
- Every merge to `main` requires a GitHub pull request with passing GitHub Actions. Do not locally merge feature or integration branches into `main` as a substitute for opening a PR.
- Prefer the primary checkout only for small, clean, bounded work. Use a dedicated worktree from the latest `origin/main` for non-trivial, risky, long-running, or parallel changes.
- When working from a dedicated worktree, copy the ignored `.env` from the primary/main checkout into the worktree before running evals, provider dogfood, grader verification, or local OpenAI OAuth proxy checks. Keep copied env files local and uncommitted; if the primary checkout has no `.env`, record that exact blocker instead of using `.env.example` as credentials.
- Non-trivial work needs a plan or task list. If the implementation surface starts to balloon, stop and re-plan.
- Large or high-risk PRs need meaningful, reviewable commits for each coherent change. Rewrite only the PR branch with `git push --force-with-lease` when needed to replace WIP or accidental squashed history before review.
- Manual red/green UAT is blocking before a branch is ready for review. GitHub Actions is the authoritative merge gate.
- Use focused local validation for changed code, debugging, and confidence. Do not default to the full local `bun run test` suite before every PR; push/open the PR to trigger GitHub Actions for broad full-suite validation. Full local `bun run test` is reserved for debugging, explicit operator request, lack of usable CI, or changes that cannot be covered by focused validation.
- For eval execution, experiments, repeat runs, providers, graders, or artifact-layout changes, dogfood with a live provider and a real LLM grader before marking ready. `agentv validate`, mock targets, replay/frozen transcript runs, and deterministic-only smoke tests are useful checks, but they are not live dogfood. Use canonical `.agentv/results/<run_id>/` output and publish private evidence. See [.agents/verification.md](.agents/verification.md).
- For browser or screenshot UAT, keep evidence out of the public repo and publish reviewable artifacts to an `agentv-private` evidence branch. See [.agents/verification.md](.agents/verification.md).
- When dogfood or review reveals a durable workflow lesson, capture it in this guide or the relevant `.agents/*.md` guide before merge; do not leave durable agent instructions only in PR comments, Bead comments, or private evidence. Use `docs/solutions/` for fuller reusable writeups.
- Research-only workers must not run `bun install`, `bun run build`, tests, or evals unless the assigned work explicitly needs that command and the worker records why.
- Prefer commit-addressed CI build artifacts over copying mutable main-tree build output. A prebuilt artifact is valid only when its manifest commit SHA, `bun.lock` hash, runner platform, Bun version expectation, and included output paths match the consuming checkout.
- Implementation workers must rebuild any package whose source they changed; never trust a prebuilt artifact for a touched package, and never publish `node_modules`, Bun caches, `.turbo`, `.cache`, or `.tsbuildinfo` as the build artifact.
- Public docs and examples should describe the current user-facing contract directly. Reserve historical context for files that are explicitly migration guides, changelogs, or ADRs. Do not reassure users that current fields are "not deprecated" or explain abandoned intermediate names; state the supported field and how to use it.
- Feature examples and dogfood should demonstrate the real user-facing use case, not merely prove that a parser path or runtime smoke test works. If an example does not show why the feature is better than the simpler existing pattern, revise the example before merge.
- Wire formats are `snake_case`; internal TypeScript is `camelCase`. Translate only at the boundary.
- In AgentV, a `project` holds runs, traces, and experiments; a `benchmark` is a curated eval suite. Do not collapse those terms.
- `artifact_pointers` are an offload indirection for large detached payload bytes, such as transcript artifacts. Do not use them as the discovery path for ordinary per-case sidecars; expose those with explicit index/manifest path fields such as `metrics_path`.

## Repo Map

- `packages/core/`: evaluation engine, providers, grading, project registry, and the programmatic API.
- `packages/sdk/`: lightweight assertion SDK such as `defineAssertion` and `defineScriptGrader`.
- `apps/cli/`: published CLI surface for `agentv`.
- `apps/web/src/content/docs/`: public product and CLI docs on agentv.dev.
- `examples/`: examples that double as reference material and integration coverage.
- `docs/adr/`: durable product and architecture boundary decisions.
- `docs/plans/`: implementation plans and temporary design artifacts.
- `docs/solutions/`: documented fixes, decisions, and best practices, organized by category.
- `CONCEPTS.md`: shared domain vocabulary.

## Routing

Reading the guide that matches your change is **required, not optional** — read it before you start the work, not after review. This file only summarizes; the guide is the contract. If your change matches more than one trigger, read each matching guide.

| If your change… | Read first (required) |
| --- | --- |
| touches TypeScript in `packages/**` or `apps/**`, wire-format keys, naming (`project`/`benchmark`, snake_case vs camelCase), grader types, `artifact_pointers`, or subprocess handling | [.agents/conventions.md](.agents/conventions.md) |
| runs or changes eval execution, experiments, repeat runs, providers, graders, or run artifacts — or needs CLI, Dashboard, docs-site, or browser/screenshot UAT | [.agents/verification.md](.agents/verification.md) |
| involves worktrees, the operator tracker, planning, branches/commits/PR flow, build/artifact reuse, or which docs/examples to update | [.agents/workflow.md](.agents/workflow.md) |
| changes a published package surface (`@agentv/core`, `@agentv/sdk`, `agentv`) — exported types, CLI flags, versioning, or npm publishing | [.agents/publish.md](.agents/publish.md) |
| proposes a feature, changes a core abstraction, or decides core vs plugin vs docs | [.agents/product-boundary.md](.agents/product-boundary.md) (start with [STRATEGY.md](STRATEGY.md) + [ROADMAP.md](ROADMAP.md)) |
| bootstraps or recovers Beads in a worktree | [docs/runbooks/beads-worktree-recovery.md](docs/runbooks/beads-worktree-recovery.md) |

Before marking any branch ready for review, run the completion checklist in [.agents/verification.md](.agents/verification.md) — including live dogfood for eval/provider/grader/artifact changes and publishing browser/screenshot UAT evidence to an `agentv-private` branch. Skipping the start-of-work read does not waive these completion gates.
