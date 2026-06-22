# Product Boundary

This file expands the summary in [AGENTS.md](../AGENTS.md). Read it when proposing features, changing core abstractions, or deciding whether something belongs in core, a plugin, or docs.

## Direction Sources

- Durable product boundary: [STRATEGY.md](../STRATEGY.md)
- Current phases and priorities: [ROADMAP.md](../ROADMAP.md)
- Architecture decisions: [docs/adr/](../docs/adr/)
- Shared vocabulary: [CONCEPTS.md](../CONCEPTS.md)

## High-Level Goals

AgentV aims to be the repo-native, workspace-native evaluation framework for AI agents.

- Repo-native evals: define evals that run against real repos, multi-repo workspaces, setup scripts, and existing harnesses.
- Zero-infra local to CI: keep the default path lightweight so the same eval contract works on a laptop and in CI.
- Portable run artifacts: treat run bundles, traces, and summaries as the source of truth for comparison, gating, and export.
- Adapter boundaries: integrate with Phoenix, Harbor, Opik, and provider-specific systems through narrow adapters instead of absorbing their concepts into core.
- AI-native extensibility: keep the core small and composable so engineers and coding agents can extend it with plugins, wrappers, and harness-specific glue.

## Phoenix Boundary

After the 2026-06-20 product decision, Phoenix is not an AgentV artifact owner or projection target.

AgentV must not export or project completed AgentV runs, traces, transcripts, datasets, experiments, or indexes into Phoenix. AgentV-owned Git/GitHub run artifacts and the local Dashboard remain the supported zero-infra inspection path for AgentV run, trace, session, transcript, and comparison data.

Phoenix may be referenced as UI inspiration and as optional external trace infrastructure when Codex, Arize, or another hook already emitted spans independently. The supported integration shape is link-out correlation through safe `external_trace` metadata. That metadata can point from an AgentV artifact to an external Phoenix trace or session and provide an `Open in Phoenix` URL, but Phoenix does not become the storage, transcript, index, or run system of record.

Dashboard must not require the `px` CLI at runtime, must not query Phoenix database tables directly, must not proxy Phoenix GraphQL/REST, and must not introduce a Phoenix runtime dependency for the zero-infra local path. If Phoenix data is needed, Dashboard should direct users to Phoenix through a safe external link instead of duplicating Phoenix sessions, traces, or spans inside AgentV.

AgentV transcript artifacts are not Phoenix-native conversation inputs. Model-call spans may contain cumulative input messages, so treating Phoenix span input as a linear transcript can duplicate or distort the conversation. Keep AgentV transcript/index/storage semantics in AgentV artifacts.

## Design Principles

### 1. Lightweight Core, Plugin Extensibility

AgentV's core should remain minimal. Complex or domain-specific logic belongs in plugins, not built-in features.

Prefer these extension points before adding a built-in:

- `code-grader` scripts for custom evaluation logic
- `llm-grader` graders with custom prompt files for domain-specific LLM grading
- CLI wrappers that consume AgentV JSON or JSONL output for post-processing such as aggregation, comparison, or reporting

Ask: can this be achieved with existing primitives plus a plugin or wrapper? If yes, it should not be a built-in. That includes niche config overrides for existing graders.

### 2. Built-ins for Primitives Only

Built-in graders should provide universal primitives that users compose. A primitive is:

- Stateless and deterministic
- Single-purpose
- Not trivially composable from existing primitives
- Needed by most users

If a feature serves a niche use case or adds conditional logic, move it to a plugin.

### 3. Maximize Feature Surface Through Composition

Aim for the maximum feature surface with the minimum primitives.

Before proposing a new feature, enumerate which existing primitives could achieve the same outcome when composed.

- Oracle validation is a `cli` provider target that runs a reference solution through the same evaluators.
- Snapshot MCP for benchmarks is frozen data in the workspace template plus `before_all` and `after_all` hooks.
- Harness variant comparison is target hooks with different `before_each` setup scripts.
- Skill evaluation is `tool-trajectory` plus `execution-metrics` plus `rubric` composed via `composite`.

If existing primitives cover the need, document the pattern instead of building a new feature. New primitives are justified only when composition is impossible, not merely undocumented.

### 4. Align with Industry Standards

Before adding features, research how peer frameworks solve the problem. Prefer the lowest common denominator that covers most use cases. Novel features without industry precedent need strong justification and should usually start as plugins.

Use public reference standards before inventing AgentV-specific contracts:

- Claude Skills for assertion, expectation, grading, and skill-eval terminology.
- Vercel agent-eval for fixture-driven agent evals, repeated attempts, hidden verifiers, and result-bundle ergonomics.
- Hugging Face Datasets for dataset, split, record, and portable corpus conventions.
- OpenInference for trace, span, tool-call, and model-observability semantics.

Treat these as reference inputs, not dependencies. AgentV should adopt the shared lowest common denominator when it fits the repo-native artifact model, and document any intentional divergence in the relevant plan, ADR, or contract docs.

### 5. YAGNI - You Aren't Gonna Need It

Do not build features until there is a concrete need. Start with the simplest version that satisfies current demand.

YAGNI also applies to how you satisfy a real request:

1. Audit existing primitives before adding new ones. Search for existing functions, endpoints, and config shapes first.
2. Treat issue language as a hint, not a spec. Strip out implementation nouns and restate the acceptance criteria in simpler terms.
3. Prefer data or config changes over new mechanisms when both satisfy the request.
4. Stop when scope doubles. If the implementation surface grows beyond the original estimate, re-plan instead of pushing through.
5. If you are about to add a second mode, a two-layer precedence rule, or an invariant between optional fields, stop and re-check whether the simpler model already exists.

If you spot current overengineering while doing other work, call it out. Open a focused tracking issue such as `cleanup: simplify X` instead of widening the current PR unless the user explicitly asks for the cleanup now.

### 6. Non-Breaking Extensions

New fields should be optional. Existing configurations must continue working unchanged.

Same-week or unreleased surfaces can be hard-deprecated. If a field, artifact name, CLI flag, or behavior was introduced in the current calendar week and has not shipped to real external consumers, prefer converging hard to the correct contract instead of carrying aliases or compatibility readers. This matters most for wire-format names: correct them to the snake_case v1 shape before release.

### 7. AI-First Design

AI agents are primary users of AgentV. Design for AI comprehension and composability.

Prefer skills over rigid commands:

- Use skills to teach AI how to create evals instead of locking everything into step-by-step command recipes.
- Skills should cover most use cases; rigid commands trade off AI intelligence.
- Prescribe exact steps only when there is an established best practice.

Keep primitives intuitive:

- Expose simple, single-purpose primitives that AI can combine flexibly.
- Avoid monolithic commands that do multiple things.
- Keep SDK internals intuitive enough for AI to modify when needed.

Keep source and docs self-describing:

- File headers should explain what the file does, how it works, and how to extend it.
- Do not reference external projects, PRs, or issues in code comments; make the module standalone.
- Prefer data-driven patterns over conditional chains.
- Delete dead code and speculative infrastructure.
- When a module has an extension point, include a short recipe for how to extend it.
- When behavior changes, update the header to match.

This applies to skills, repo structure, documentation, SDK design, and source code.
