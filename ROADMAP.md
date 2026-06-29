# AgentV Roadmap

Last updated: 2026-06-21

This roadmap translates [STRATEGY.md](STRATEGY.md) into the next few product phases. It is intentionally short: the goal is to keep priorities and boundaries visible without turning the roadmap into a plan dump.

## Guardrails

- AgentV remains the repo-native, workspace-native runner, grader, and artifact source of truth.
- The AgentV Dashboard is the supported zero-infra local cockpit for AgentV-owned runs, traces, sessions, transcripts, and Git-backed artifacts.
- Phoenix is optional external trace infrastructure only when Codex, Arize, or another hook already emitted spans independently; AgentV may correlate with those sessions but does not write AgentV artifacts into Phoenix.
- Harbor stays an optional benchmark-grade runner boundary, not AgentV core.
- AgentV YAML remains the authoring surface even when execution moves behind another runner; prefer a lightweight translation layer over duplicated specs.
- Adapters, workers, and artifact projections are preferred over rebuilding adjacent platforms inside AgentV, except Phoenix: Phoenix integration is link-out correlation only and not an AgentV-to-Phoenix projection path.

## Phase 1: Finish the artifact and local inspection foundation

- Keep the canonical handoff surface centered on completed run bundles, `run_manifest.jsonl`, grading/timing/metrics artifacts, normalized transcripts, and optional `external_trace` link metadata.
- Finish the vendor-neutral local export seams that let completed runs be re-read, compared, exported, and attached to non-Phoenix adapters without vendor-specific logic in core.
- Keep OTLP/OpenInference mapping generic and reusable before building backend-specific upload or import paths.

## Phase 2: Keep Phoenix link-only and externally owned

- Document the Phoenix boundary across public docs, CLI help, Dashboard copy, and AI-facing guides.
- Allow optional Phoenix links when safe `external_trace` metadata points at spans emitted independently by Codex, Arize, or another hook.
- Keep Phoenix from owning AgentV transcript, index, run, dataset, experiment, or storage state.
- Keep Dashboard free of a Phoenix runtime dependency: no `px` CLI requirement, no Phoenix GraphQL/REST proxy, and no direct reads from Phoenix database tables.

## Phase 3: Strengthen the local cockpit and the product boundary

- Keep the AgentV Dashboard focused on quick local inspection, comparison, and zero-infra review.
- Add lightweight links from local AgentV artifacts to external trace viewers when safe metadata exists.
- Clarify the split across docs, CLI help, Dashboard copy, and skills so users know that AgentV artifacts stay local/Git-backed and Phoenix is optional read-only context.
- Docs hygiene follow-up: split large AI-facing guidance such as `AGENTS.md` into linked instruction files if that makes the boundary easier to maintain.

## Phase 4: Extend outward through optional boundaries

- Harbor: move toward Harbor becoming the benchmark-grade runner behind a lightweight translation layer from AgentV YAML, while AgentV stays the authoring, gating, import, and comparison surface.
- Harbor: in the near term, launch or import benchmark-grade runs through a runner boundary; over time, converge on Harbor as the execution layer for the suites it already owns.
- Opik and similar systems: consume completed AgentV projection bundles as post-run adapters rather than as runtime owners.
- Phoenix: remain excluded from AgentV post-run export/projection; use link-out correlation only.
- Additional observability backends should reuse the same projection and export seams instead of adding new core product models.

## Not On This Roadmap

- Rebuilding Phoenix, Opik, Langfuse, or similar products inside AgentV.
- Turning AgentV into a hosted experiment platform, benchmark catalog, or generic dashboard platform.
- Deleting the local Dashboard in favor of Phoenix.
- Exporting or projecting AgentV runs, traces, transcripts, datasets, experiments, or indexes into Phoenix.
- Requiring `px`, Phoenix database access, or Phoenix-owned storage for Dashboard runtime.
