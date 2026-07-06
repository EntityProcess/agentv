# 19. Promptfoo compatibility and environment boundary

Date: 2026-07-06

## Status

Accepted (2026-07-06). Records the research conclusion from Bead `av-236z`
and anchors the documentation work in Bead `av-oxub`.

Companion to [ADR 0016](0016-promptfoo-superset-eval-authoring-contract.md),
[ADR 0017](0017-output-artifact-and-workspace-resolver-contract.md), and
[ADR 0018](0018-coding-agent-target-runtime-contract.md).

## Context

AgentV is adopting Promptfoo-compatible matrix authoring where the concepts
overlap: prompts, tests, vars, default test data, assertions, target matrices,
top-level `env`, lifecycle `extensions`, and result-grading vocabulary. That
compatibility does not make Promptfoo the runtime owner for repo-native
environment setup.

AgentV's current vocabulary already separates these concepts in
`CONCEPTS.md`: providers are backend adapters, targets are systems under test,
`environment` is the authored host/Docker testbed recipe, `workdir` is the cwd
inside that prepared testbed, top-level `env` is Promptfoo-compatible
provider/eval configuration, and extensions are lifecycle hooks rather than the
canonical testbed materialization contract.

The AgentV implementation reflects that boundary:

- `packages/core/src/evaluation/loaders/environment-recipe.ts` resolves inline
  or `file://` recipes, validates `type: host|docker`, handles `workdir`,
  setup commands, recipe-scoped `env`, Docker context/image/mount/resource
  fields, and records recipe hashes and file provenance.
- `packages/core/src/evaluation/environment/host.ts` creates the host workdir
  and runs `environment.setup.command` with `AGENTV_ENVIRONMENT_WORKDIR` and
  recipe-scoped environment variables.
- `packages/core/src/evaluation/environment/docker.ts` builds or pulls the
  Docker image, translates the recipe into a sandbox runtime, carries mounts,
  resources, secrets, container env, workdir, and setup commands.
- `packages/core/src/evaluation/orchestrator.ts` prepares the case workspace,
  applies environment-derived target runtime/cwd, invokes targets with
  `cwd: targetCwd ?? workspacePath`, passes the same workspace to graders and
  hooks, and attaches environment provenance to success and setup/error
  results.
- `packages/core/src/evaluation/run-artifacts.ts` writes per-sample
  `environment.json`, adds `environment_path` and environment summaries to
  result artifacts, and rolls distinct environments into run-level
  `summary.json` metadata.
- Public docs in
  `apps/web/src/content/docs/docs/next/guides/workspace-architecture.mdx` and
  `apps/web/src/content/docs/docs/next/reference/promptfoo-parity.mdx` describe
  `environment` as an AgentV extension used for host/Docker workdir, setup,
  fixtures, services, and repo materialization.

Promptfoo was checked locally at `/home/entity/projects/promptfoo/promptfoo`
commit `6bfc5a0c7f16f9c4717ac731d276b578e63d0769`. Relevant findings:

- `src/types/index.ts` centers the suite schema on `providers`, `prompts`,
  `tests`, `defaultTest`, top-level `env`, `extensions`, and a `targets` alias
  that is normalized back to `providers`. It does not define a typed
  suite-level environment recipe for host/Docker testbeds.
- `src/evaluatorHelpers.ts` extension hooks can mutate suite, test, and result
  context. They are useful lifecycle hooks, but they do not provide typed
  workdir, Docker/image, setup, fixture, or provenance semantics.
- `src/providers/openai/codex-sdk.ts` includes provider-specific
  `working_dir`, `cli_env`, and related Codex runtime options. That is useful
  for one provider, but it is not a cross-target environment contract.
- `src/evaluate.ts` and Promptfoo result types consolidate Promptfoo results
  around `EvaluateResult` and `EvaluateSummaryV3`; they do not preserve
  AgentV's split run bundle, transcript, Dashboard identity, environment
  artifact, and grader/workspace provenance model.

Promptfoo primitives can approximate parts of environment setup through
extensions, custom providers, provider-specific `working_dir`, top-level `env`,
and provider config. They cannot faithfully represent AgentV's authored
environment semantics as data: shared suite/test/case host or Docker substrate,
workdir propagation across targets and graders, setup provenance, recipe hashes,
run-bundle environment artifacts, transcript linkage, Dashboard identity, and
workspace provenance.

## Decision

Keep `environment` as an AgentV-native typed testbed primitive. AgentV remains
the runtime and artifact owner for environment-bearing evals.

Promptfoo compatibility covers overlapping authoring fields and adapter paths:
import, export, and transpilation may translate Promptfoo-shaped prompts,
tests, vars, assertions, default test data, targets/providers, top-level `env`,
extensions, and grading-result vocabulary where semantics match. AgentV keeps
its own `environment` recipe contract for repo-native host/Docker setup, cwd
propagation, run bundles, transcripts, Dashboard identity, and
grader/workspace provenance.

Promptfoo-first authoring still fits AgentV's matrix model. Users can author
Promptfoo-like prompt and test matrices, but AgentV does not rename top-level
`targets` to Promptfoo `providers`. In AgentV, `targets[].id` is stable system
under test identity and `targets[].provider` names the backend or adapter kind.
`environment` is separate from target identity and is prepared before targets
and graders run.

## Options Considered

### 1. Keep AgentV environment native with Promptfoo adapters

Accepted.

This preserves AgentV's repo-native value: one typed environment recipe prepares
the host or Docker state, establishes cwd, records provenance, and feeds the
same prepared workspace to targets, graders, transcripts, and artifacts.
Promptfoo compatibility stays useful where the schemas overlap without forcing
AgentV to encode its testbed contract as hook side effects or provider-specific
options.

### 2. Transpile AgentV environment into Promptfoo primitives while AgentV still orchestrates

Rejected as the canonical path.

AgentV can provide lossy export or adapter output for interoperability, but a
transpiled Promptfoo config would be an approximation. Environment setup would
spread across extensions, custom providers, provider-specific `working_dir`, and
top-level/provider env fields. That shape hides the typed substrate, weakens
provenance, and creates two contracts for cwd and setup ordering while AgentV
would still need to keep its native orchestrator to preserve run bundles and
grader behavior.

### 3. Use Promptfoo SDK under the hood for environment-bearing evals

Rejected.

Delegating environment-bearing execution to Promptfoo would move the center of
the run into a framework that does not own AgentV's typed environment recipe,
split artifact layout, normalized transcripts, Dashboard identity, or
workspace/grader provenance. AgentV would need a second reconstruction layer to
recover the data its own orchestrator already has at the right boundaries. That
adds risk without improving the repo-native execution model.

## Consequences

- AgentV environment-bearing evals continue to run through AgentV's
  orchestrator, not the Promptfoo SDK.
- Promptfoo compatibility remains composition by overlap, not wholesale schema
  adoption. Adapters may be useful, but native AgentV artifacts remain the
  source of truth.
- Public docs should teach `environment` directly for host/Docker testbeds and
  reserve `extensions` for lifecycle customization after the testbed contract is
  explicit.
- `targets` and `provider` keep their AgentV meanings. Future Promptfoo import
  or export work must translate those names intentionally rather than adding
  runtime aliases that overload provider identity.
- Environment provenance remains visible in run artifacts, including recipe
  hashes, authored references, workdir, setup status, and per-sample
  environment sidecars.
