# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Providers and Targets

**Provider** — The eval YAML or config declaration for a system under test. AgentV is Promptfoo-compatible at this provider declaration layer: entries may be strings such as `openai:gpt-4.1-mini`, complete package provider strings such as `package:@agentv/promptfoo-providers:CodexCliProvider` or `package:@agentv/promptfoo-providers/codex-cli:Provider`, provider option objects with `id`, `label`, `config`, `env`, `prompts`, `transform`, `delay`, and `inputs`, or provider maps such as `{ "openai:gpt-4": { label, config } }`. Package provider strings must include the exported class/function segment after the final colon. In AgentV, `id` names the backend/spec and `label` is the stable AgentV selection identity. AgentV-only provider fields such as `runtime` or provider-local testbed/runtime overlays are AgentV semantics, not full Promptfoo execution compatibility. A single eval file can declare multiple providers to compare AI systems side by side. Providers select agents/adapters; they do not own the authored host/Docker testbed recipe.

**Provider adapter** — The plugin/runtime implementation that connects AgentV's evaluation engine to a specific AI system, such as Copilot CLI, Copilot SDK, Claude API, or Pi. Provider adapters implement the request/response contract: given a test case, invoke the AI system and return its output. Public `providers[]` entries select and configure these adapters by `id`.

**Target** — Internal/runtime and artifact vocabulary for the stable comparison dimension produced by a selected provider. Result rows and run-bundle indexes keep the `target` field as the stable source identity until a separate artifact migration changes that contract.

**Provider runtime** — The placement/transport mode for invoking a provider, such as host execution, sandbox/container placement, CLI subprocess, app-server protocol, RPC, or SDK child runner. Runtime describes how the selected agent is invoked. Advanced home/env/profile-style overlays are provider or runtime configuration details, not the authored testbed recipe. Runtime is separate from the environment that prepares files, services, and cwd.

**Grader (selection)** — Not a distinct entity type. A grader is a regular provider, listed under `providers` like any other and selected for a grading role via `defaults.grader`, CLI `--grader-provider`, `default_test.options.provider`, `tests[].options.provider`, or an assertion-level `provider` override. Authoring a separate `graders:` list is a hard error: move each entry into `providers`. This also means a grader can itself be the provider under evaluation for oracle/calibration checks, which a separate schema would block. Do not confuse this with **grader (method)** — an assertion `type` such as `llm-rubric`, `code-grader`, or `g-eval` that names *how* scoring works, independent of *which* provider performs it; or with a rubric's `criteria`/`value`, which is the grading *prompt*. AgentV once called grader-selection "judge" (`judge_target`) before a deliberate, full rename to "grader" — do not reintroduce "judge" without a stronger reason than surface-level clarity, since peer frameworks (Margin-Lab/evals, Harbor) don't treat judge/grader as a first-class schema concept either.

**Provider runtime boundary** — The process boundary between AgentV's evaluation orchestrator and the agent runtime a provider invokes. CLI-backed providers place the agent runtime outside the orchestrator; SDK providers should run through an AgentV-owned child-runner boundary when runtime teardown can threaten run artifact finalization. This boundary does not own repository/testbed setup by default.

## Evaluation Model

**Eval / Eval YAML** — The composable and runnable AgentV authoring primitive. An eval YAML file describes the prompts, tests, variables, providers, assertions, environments, tags, and run policy for an evaluation. AgentV does not have a separate runnable `experiment.yaml` artifact.

**Matrix authoring** — The Promptfoo-compatible shape AgentV adopts where useful: `prompts x tests/vars x providers`, with repeat samples and retries applied as run policy after the authored matrix is resolved. AgentV is a Promptfoo-compatible superset at the provider declaration layer, not a fully Promptfoo-executable config format. AgentV-native boundaries remain: provider `id` names the backend/spec, provider `label` is the stable AgentV identity, `environment` recipes prepare coding-agent testbeds, `env` carries provider/eval variables, `extensions` are lifecycle hooks, reusable content uses field-local `file://` refs, and grouping uses tags plus run-bundle metadata.

**Task suite** — Eval YAML that owns what is being tested: prompts, datasets, input files, fixtures, `environment`, assertions, expected references, and judge criteria. It runs directly or shares reusable parts through field-local `file://` refs such as `prompts: file://...`, `tests: file://...`, `default_test: file://...`, and `environment: file://...`.

**Raw case file** — YAML, JSONL, or directory case data loaded with `tests: file://./cases.yaml`, string shorthand, or another supported field-local tests reference. Raw cases are reusable data inputs; they do not carry suite context such as shared `environment`, shared `prompts`, or shared `assertions`.

**Policy eval** — Eval YAML whose main job is to bind top-level runtime policy such as provider selection, repeat count, timeout, budget, thresholds, and tags around explicit prompts/tests/providers refs. Policy evals may live under an `experiments/` directory, but that path is an optional user-owned convention and AgentV does not infer behavior from it. Use tags and run-bundle metadata for grouping rather than experiment path buckets, Vercel path layout, model-as-experiment grouping, or wrapper-suite import semantics.

**Multi-file run** — A CLI-selected set of eval YAML files. Use multiple eval files, tags, and CLI run selection to group suites under one run intent without adding wrapper-suite semantics to YAML.

**Experiment** — A string metadata/run-grouping label such as `baseline`, `candidate`, `with_skills`, or `without_skills`. It is not a runtime-policy object and not a result path namespace. Experiment is expressed as the reserved `tags.experiment` key (see **Tags**); there is no top-level `experiment` field. Runtime policy belongs in top-level eval fields or provider objects; the experiment label is recorded in `summary.json` and `.internal/index.jsonl` for Dashboard grouping and comparison. Lifecycle setup belongs in `extensions` or provider hooks, not in a separate experiment artifact.

**Tags** — A promptfoo-shaped `Record<string,string>` map authored on an eval (or project config / `--tag key=value`) that labels a run with structured facets such as `experiment`, `team`, or `env`. The reserved `experiment` key feeds the experiment namespace. The resolved map is recorded in `summary.json` `metadata.tags` and every `.internal/index.jsonl` row, and the Dashboard "Tags" tab groups and compares runs by any tag key. This is the only "tags" concept: the earlier free-form manual per-run tag chips have been removed. (Suite-level `tags` may still be authored as a string list, which is a selection construct for `select.tags` / `--tag name` filtering rather than run metadata.)

**Environment** — The AgentV-authored testbed recipe for coding-agent evals. It prepares the host or Docker state an agent will inspect or modify: repositories, archives, patches, generated fixtures, services, dependency setup, and cwd. `environment` can be inline or loaded with `file://`, with shared `file://` recipes as the canonical reusable form. Initial `environment.type` values are `host` and `docker`. Promptfoo does not define this primitive; it is an AgentV extension, and Promptfoo will not execute this setup without a transpiler or wrapper.

**Workdir** — The current working directory inside an environment. `environment.workdir` is the cwd passed to target providers and graders/test scripts unless a later scoped feature explicitly overrides it. Host workdirs are local paths such as `./workspaces/bottle`; Docker workdirs are container paths such as `/app`.

**Top-level `env`** — Promptfoo-compatible provider/eval environment-variable overrides and load-time template inputs such as `OPENAI_API_KEY: "{{ env.OPENAI_API_KEY }}"`. Top-level `env` is not the testbed recipe and must not be moved under `environment`.

**`environment.env`** — Future or recipe-scoped variables for the host/Docker testbed itself, such as container process environment. It is distinct from top-level `env`, which feeds provider/eval config templating.

**Extensions** — Promptfoo-compatible lifecycle hooks such as `beforeAll`, `beforeEach`, `afterEach`, and `afterAll`. Extensions can customize eval flow, but they are not the canonical contract for materializing repositories, Docker images, fixtures, or cwd. A `beforeAll` hook can run setup code, but then cwd, Docker/image/resource config, and testbed provenance are hidden in executable hook side effects instead of authored data. Use `environment.setup` for authored testbed setup.

**Workspace** — Not the public AgentV coding-agent testbed contract. Where older docs or code use `workspace` or `workspace.repos[]` to mean the authored testbed, that naming is migration debt toward `environment`. The word may still describe ordinary mutable directories, local checkout state, or implementation-specific working folders when it is not a competing authored YAML primitive.

**Environment recipe examples**:

```yaml
environment: file://.agentv/environments/local-python.yaml

providers:
  - id: codex-cli
    label: codex
```

```yaml
# .agentv/environments/local-python.yaml
type: host
workdir: ./workspaces/bottle
setup:
  command:
    - bash
    - ./scripts/setup-workspace.sh
    - https://github.com/bottlepy/bottle.git
    - 0207a34f0c5716cd292dd4480253ad35d3da49f3
    - ./workspaces/bottle
  timeout_ms: 120000
```

```yaml
environment:
  type: docker
  context: ./environment
  workdir: /app
  env:
    NODE_ENV: test

env:
  OPENAI_API_KEY: "{{ env.OPENAI_API_KEY }}"
```

**Run bundle** — A committed local result directory at `.agentv/results/<run_id>/`. `summary.json` records run metadata such as `run_id` and `experiment`; `.internal/index.jsonl` records per-case rows. Run bundles, traces, transcripts, datasets, indexes, and Git-backed artifacts stay AgentV-owned. They are not discovered through an Opik export path or a Phoenix projection path; optional Phoenix integration is link-out correlation only through safe `external_trace` metadata.

**Run manifest** — The root `summary.json` file in a run bundle. It owns aggregate run metadata and rollups such as `run_id`, `experiment`, timestamps, planned/completed counts, pass rate, score summaries, duration, tokens, and cost.

**Result index** — The `.internal/index.jsonl` file in a run bundle. It is the dashboard and tooling loading contract for per-case result rows and artifact locations, including fields such as `result_dir`, `test_dir`, `summary_path`, `grading_path`, and `metrics_path`.

**Result source identity** — The stable source identity for a result row: repo-relative `eval_path`, `test_id`, and `target`. `suite` and `name` are display metadata, not storage or routing identity.

**Result directory** — The `result_dir` field in a `.internal/index.jsonl` row. It is a run-local directory allocation for that row's sidecars and outputs, usually a readable test-id or slug prefix plus a UUID/hash-like suffix. Consumers discover it from `.internal/index.jsonl` and must not infer it from suite names, display names, test IDs, targets, models, or folder position.

**Artifact directory** — A directory in a run bundle that stores result evidence or generated outputs. Artifact directories are discovered through fields such as `result_dir`, `grading_path`, `metrics_path`, `transcript_path`, and `outputs_path`; they are not the same thing as `environment.workdir` and do not define where the target runs.

**Artifact sidecar** — A file beside or below a result directory that provides evidence for a result, such as `summary.json`, `grading.json`, `result.json`, transcripts, logs, or outputs. Sidecars are evidence, not the primary discovery mechanism for a run.

**Artifact sample folder** — A per-case `sample-N/` folder under a result directory. It stores one materialized execution's sidecars and outputs. It is not the primary comparison dimension: stochastic samples and infrastructure retries are represented with explicit `sample_index` and `retry_index` metadata rather than inferred from folder position.

## Evaluation Reliability

**Repeat run** — A configured request to execute the same eval case and target more than once in the same run bundle. Repeat runs measure stochastic reliability, verifier stability, and drift; they are not the default CI path.

**Attempt** — One concrete execution inside a repeat run. Attempts keep their own score, status, metrics, trace, transcript, logs, and artifacts so aggregate results never hide individual evidence.

**Pass rate** — Assertion or expectation pass rate inside a grading result: passed assertions or expectations divided by total assertions or expectations. AgentV does not use `pass_rate` for repeat-attempt success frequency.

**Attempt success rate** — Repeat-run reliability metric equal to successful counted attempts divided by counted attempts. This is distinct from `pass_rate`, which is reserved for assertion or expectation pass rate within a grading result.

**Gate policy** — The explicit rule that decides whether repeated attempts pass CI, such as `all_attempts_successful`, `any_attempt_successful`, `attempt_success_rate_at_least`, or `mean_pass_rate_at_least`. Without a repeat-run gate policy, AgentV preserves the normal single-run gate behavior and treats repeat statistics as report data.

**Flaky eval outcome** — A repeat-run aggregate whose attempts disagree, or whose failure classification points at verifier, infrastructure, or timeout instability rather than a stable model-quality failure.

## Release Channels

**Stable release** — A package publication channel whose surfaces are treated as compatibility commitments for normal users.

**Next tag** — A prerelease package channel used to validate upcoming AgentV surfaces before they become stable compatibility commitments.

Next-tag-only surfaces may be hard-corrected before stable release when preserving them would encode an unsafe or misleading contract. Stable-release surfaces need an explicit compatibility or migration strategy.
