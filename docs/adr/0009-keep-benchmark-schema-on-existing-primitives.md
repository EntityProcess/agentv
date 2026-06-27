# 9. Keep benchmark schema on existing primitives

Date: 2026-06-27

## Status

Proposed

## Context

Research for bead `av-2h9` compared AgentV with SWE-bench, SWE-bench Verified,
Harbor, Margin Evals, Vercel `agent-eval`, OpenAI Evals, Inspect, Braintrust,
promptfoo, LangSmith, Hugging Face Datasets, and OpenInference.

Those systems converge on stable case identity, dataset splits, repo or fixture
provenance, expected/reference data, executable graders, repeat policy, result
identity, and portable artifacts. They do not converge on a shared runner or
workspace schema.

AgentV already has the core primitives needed for that lowest-common
denominator:

- `tests[].id` and `tests[].metadata` for case identity and imported row
  provenance;
- `workspace.repos[]`, templates, hooks, and isolation for operational setup;
- inline `experiment:` for target binding, repeat policy, gates, and runtime
  knobs;
- `expected_output`, assertions, and code graders for reference data and hidden
  verification;
- AgentV run bundles as the artifact source of truth.

The important AgentV difference is workspace composition. Public coding-agent
benchmarks usually assume one repo, one fixture directory, or one container.
AgentV can materialize multiple repositories into one eval workspace. A new
generic `source` block would either duplicate `workspace.repos[]` or become
non-operational metadata. Neither case justifies more core schema.

## Decision

Do not add a new top-level `source` field from this research. Do not rename
`workspace.repos[].commit` to `base_commit`.

AgentV should continue to model benchmark-shaped evals with existing
primitives:

- Repository acquisition and checkout pins stay in `workspace.repos[]`.
- `workspace.repos[].commit` remains the canonical checkout ref field.
- `base_commit` is a SWE-bench import or compatibility alias only if an adapter
  needs to preserve upstream vocabulary; it should not become the canonical
  hand-authored AgentV field.
- Runtime policy stays in inline `experiment:`.
- Target-specific setup remains in target hooks, workspace hooks, assertions,
  and code graders.
- Benchmark row details stay in `tests[].metadata`, source-owned sidecars, or
  adapter-generated manifests.
- External benchmark runners such as Harbor stay behind runner/import
  boundaries.

For eval composition, the parent runnable eval owns runtime policy. If a parent
references child eval files, the parent should ignore or override child
`experiment:` by default. It should not silently discard child `workspace`
requirements. Child workspace setup is part of the imported cases' validity and
must be retained, merged with explicit collision rules, or explicitly remapped
by the parent. A "tests only" import mode may drop child workspace context, but
that must be opt-in.

## Consequences

Positive:

- AgentV avoids duplicating existing workspace and metadata concepts.
- The multi-repo workspace contract stays a product differentiator instead of
  being collapsed into single-source benchmark vocabulary.
- SWE-bench, Harbor, Margin, promptfoo, Braintrust, LangSmith, OpenAI Evals,
  Inspect, and Hugging Face mappings can remain adapters or docs recipes that
  emit ordinary AgentV evals.
- Existing authoring concepts remain stable: workspace for setup, experiment
  for runtime, tests for cases, metadata for source row details, run bundles for
  audit.
- The `commit` field stays self-evident inside `workspace.repos[]`.

Negative:

- AgentV still needs strong docs examples so authors do not invent competing
  provenance keys.
- Import/composition behavior needs a focused follow-up if parent evals include
  child evals with conflicting workspaces.
- Some imported benchmark vocabulary such as SWE-bench `base_commit` must be
  translated at the adapter boundary.

## Alternatives Considered

- **Add top-level `source`.** Rejected. If it performs repo acquisition, it
  conflicts with `workspace.repos[]`; if it is informational, it duplicates
  metadata and sidecar manifests.
- **Use `source` for Harbor suite selection.** Rejected for core schema in this
  decision. Harbor-backed execution should remain a runner/import boundary
  until repeated usage proves a small AgentV selector is necessary.
- **Rename `commit` to `base_commit`.** Rejected. `base_commit` is useful
  SWE-bench vocabulary, but `workspace.repos[].commit` is already scoped to a
  checkout and works for branches, tags, SHAs, and non-SWE benchmarks.
- **Drop child workspaces when importing child evals.** Rejected as a default.
  That turns valid imported cases into tests detached from their setup.
- **Copy benchmark-specific fields into AgentV.** Rejected. SWE-bench patches,
  Harbor task TOML, Margin suite config, promptfoo provider matrices, and
  Braintrust hosted experiment fields stay in adapters, fixtures, metadata, or
  source-owned files.

## Non-Goals

- Implementing schema changes in this ADR.
- Defining a benchmark catalog.
- Rebuilding hosted experiment stores such as Braintrust or LangSmith.
- Making Harbor task packaging, verifier images, or Compose adapters
  AgentV-native schema.
- Making Phoenix, OpenInference, or any trace backend the AgentV artifact owner.

## References

- Research artifact: [docs/plans/2026-06-27-001-docs-agentv-schema-benchmark-research-plan.md](../plans/2026-06-27-001-docs-agentv-schema-benchmark-research-plan.md)
- Strategy: [STRATEGY.md](../../STRATEGY.md)
- Roadmap: [ROADMAP.md](../../ROADMAP.md)
- Product boundary: [.agents/product-boundary.md](../../.agents/product-boundary.md)
- Technical conventions: [.agents/conventions.md](../../.agents/conventions.md)
- Harbor boundary: [docs/adr/0002-keep-harbor-benchmark-execution-behind-runner-boundary.md](0002-keep-harbor-benchmark-execution-behind-runner-boundary.md)
- Inline experiment decision: [docs/adr/0006-separate-experiments-from-eval-definitions.md](0006-separate-experiments-from-eval-definitions.md)
