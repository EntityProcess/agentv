# AgentV Roadmap

Last updated: 2026-06-19

This roadmap translates [STRATEGY.md](STRATEGY.md) into the next few product phases. It is intentionally short: the goal is to keep priorities and boundaries visible without turning the roadmap into a plan dump.

## Guardrails

- AgentV remains the repo-native, workspace-native runner, grader, and artifact source of truth.
- Phoenix is the preferred shared UI for traces, experiments, and longitudinal results analysis.
- The AgentV Dashboard stays valuable as the zero-infra local cockpit; this roadmap does not deprecate it.
- Harbor stays an optional benchmark-grade runner boundary, not AgentV core.
- AgentV YAML remains the authoring surface even when execution moves behind another runner; prefer a lightweight translation layer over duplicated specs.
- Adapters, workers, and artifact projections are preferred over rebuilding adjacent platforms inside AgentV.

## Phase 1: Finish the artifact and projection foundation

- Keep the canonical handoff surface centered on completed run bundles, `index.jsonl`, grading/timing artifacts, and execution-trace sidecars.
- Finish the vendor-neutral projection/export seams that let completed runs be re-read, compared, exported, and attached to adapters without vendor-specific logic in core.
- Keep OTLP/OpenInference mapping generic and reusable before building backend-specific upload or import paths.

## Phase 2: Make Phoenix the shared UI over AgentV-native execution

- Add a Phoenix-triggered AgentV worker/runner contract so Phoenix can request or attach to real AgentV runs without owning workspace lifecycle, target execution, or grader semantics.
- Project completed AgentV run bundles and execution traces into Phoenix through adapter workers that preserve AgentV IDs, score provenance, and links back to local artifacts.
- Keep missing worker/config/trace state explicit: failures should surface as execution or import errors, not as silent evaluator passes.

## Phase 3: Strengthen the local cockpit and the product boundary

- Keep the AgentV Dashboard focused on quick local inspection, comparison, and zero-infra review.
- Add lightweight handoff points between local AgentV artifacts and Phoenix when a shared UI exists.
- Clarify the split across docs, CLI help, Dashboard copy, and skills so users know when to stay local and when to attach Phoenix.
- Docs hygiene follow-up: split large AI-facing guidance such as `AGENTS.md` into linked instruction files if that makes the boundary easier to maintain.

## Phase 4: Extend outward through optional boundaries

- Harbor: move toward Harbor becoming the benchmark-grade runner behind a lightweight translation layer from AgentV YAML, while AgentV stays the authoring, gating, import, and comparison surface.
- Harbor: in the near term, launch or import benchmark-grade runs through a runner boundary; over time, converge on Harbor as the execution layer for the suites it already owns.
- Opik and similar systems: consume completed AgentV projection bundles as post-run adapters rather than as runtime owners.
- Additional observability backends should reuse the same projection and export seams instead of adding new core product models.

## Not On This Roadmap

- Rebuilding Phoenix, Opik, Langfuse, or similar products inside AgentV.
- Turning AgentV into a hosted experiment platform, benchmark catalog, or generic dashboard platform.
- Deleting the local Dashboard in favor of Phoenix.
