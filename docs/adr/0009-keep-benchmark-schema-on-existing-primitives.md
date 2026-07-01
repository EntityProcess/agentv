# 9. Keep benchmark schema on existing primitives

Date: 2026-06-27

## Status

Proposed

Superseded for the current eval authoring contract by
[ADR 0013](0013-stabilize-eval-authoring-contract.md): top-level
`experiment:` remains the optional string run/result grouping label, top-level
authoring `tags` are removed from the preferred contract, `cases` / `case_id`
replace `tests` / `test_id` as preferred vocabulary, and top-level `gate`
replaces scalar `threshold`.

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
- top-level `target` plus `policy` for target binding, repeat policy, gates,
  and runtime knobs;
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

The same minimal-primitives rule applies to experiment display and repo layout.
AgentV should not add an authored `run_group` field or revive separate
`experiment.yaml` files. The existing `experiment` namespace remains the
artifact and Dashboard grouping primitive. Projects may use an `experiments/`
directory for wrapper eval YAML files, but that directory is only a
documentation and repo-organization convention. AgentV must not infer behavior
from the folder name.

For eval composition, the parent runnable eval owns runtime policy. If a parent
references child eval files with `type: suite`, the current loader ignores the
child `experiment:` block and uses the parent `experiment:` when one exists; it
does not fall back to the child `experiment:`. Workspace follows task ownership,
not runtime fallback: imported child tests keep the child suite workspace that
was already expanded into those tests. Therefore a parent eval that imports any
child eval with `type: suite` must not define parent `workspace`. Parent
workspace context is valid for parent-owned raw cases only, including raw cases
imported with `type: tests` or shorthand paths. Machine-local existing workspace
paths are no longer authored in eval YAML; they belong in CLI flags or
`config.local.yaml`. Task environment fields remain in top-level or case-level
`workspace`. A "tests only" import mode may drop child workspace context, but
that must be opt-in.

ADR 0006 defines the contract-layer model behind this rule: task data, task
prompt, task environment, and scoring come from the imported child suite; run
policy comes from the parent wrapper eval or CLI. `workspace` is task
environment, not prompt input, even though agents may inspect it through tools.

If a future composition feature allows parent workspace override or remapping
for imported suites, it should be explicit and logged. The default should not
silently replace child workspace setup, because that setup is part of the
imported cases' validity.

This decision creates follow-up behavior and docs beads:

- `av-pkp` adds authoring diagnostics for misleading wrapper composition,
  including forbidden parent workspace on suite-import wrappers and ignored
  child experiments.
- `av-ha5` rejects parent workspace on suite-import wrappers and guards
  incompatible imported-suite shared workspace compositions so one wrapper run
  cannot silently use the wrong shared workspace.
- `av-82t` improves Dashboard/report display of the existing experiment
  namespace and derived runtime source without adding new authored primitives.
- `av-58q` teaches the optional `evals/suites/` and `experiments/`
  wrapper-eval folder convention without making the path schema-significant.
- `av-dxp` adds a regression eval for this architecture decision so future
  agents do not recommend parent workspace on suite-import wrappers.

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
- Dashboard and reports can become clearer by explaining runtime source over
  existing artifacts instead of adding configuration surface.

Negative:

- AgentV still needs strong docs examples so authors do not invent competing
  provenance keys.
- Import/composition behavior needs focused diagnostics because parent
  `workspace` is invalid on suite-import wrappers and child suite workspaces
  remain task-owned.
- Some imported benchmark vocabulary such as SWE-bench `base_commit` must be
  translated at the adapter boundary.
- Diagnostics are needed because the one-primitive model puts task suites and
  wrapper experiments in the same file format.

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
- **Allow parent workspace on suite-import wrappers.** Rejected. It creates a
  misleading merge/override question inside a one-primitive authoring model.
  Parent evals that need workspace context should import raw cases with
  `type: tests`; wrapper evals that import suites own runtime policy only.
- **Copy benchmark-specific fields into AgentV.** Rejected. SWE-bench patches,
  Harbor task TOML, Margin suite config, promptfoo provider matrices, and
  Braintrust hosted experiment fields stay in adapters, fixtures, metadata, or
  source-owned files.
- **Add authored `run_group`.** Rejected. The existing `experiment` namespace is
  enough for artifact grouping. Runtime source should be derived for display,
  not configured as another primitive.
- **Revive separate experiment artifacts.** Rejected. Wrapper experiments are
  ordinary eval YAML files with inline `experiment:` blocks.
- **Make `experiments/` schema-significant.** Rejected. The folder may be a
  user-owned repo layout convention, but AgentV should not infer semantics from
  it.
- **Implicitly merge parent and child workspaces.** Rejected for now. Hook
  order, repo path conflicts, isolation mode conflicts, and reset policies make
  implicit merge too surprising. A future merge/override mode must be explicit
  if real usage justifies it.

## Non-Goals

- Implementing schema changes in this ADR.
- Defining a benchmark catalog.
- Adding authored `run_group` or separate `experiment.yaml` primitives.
- Making `experiments/` schema-significant rather than a plain repo layout
  convention for wrapper eval YAML.
- Implicitly merging parent and imported child workspaces.
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
