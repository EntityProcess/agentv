# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Providers and Targets

**Provider** — an adapter plugin that connects AgentV's evaluation engine to a specific AI system (e.g., copilot CLI, copilot SDK, Claude API, pi). Each provider implements the request/response contract: given a test case, invoke the AI system and return its output. Providers are selected per-target in eval YAML and can be extended via the provider registry.

**Target** — the eval YAML declaration that activates a specific provider for an evaluation run. A target names the provider, supplies configuration (model, API keys, timeouts, passthrough args), and scopes to a subset of test cases when needed. A single eval file can declare multiple targets to compare AI systems side by side.

**Provider runtime boundary** — the process boundary between AgentV's evaluation orchestrator and the agent runtime a provider invokes. CLI-backed providers place the agent runtime outside the orchestrator; in-process SDK providers share the orchestrator process and need either a targeted transport fix or subprocess-style isolation when runtime teardown can threaten run artifact finalization.

## Evaluation Model

**Eval / Eval YAML** — The only composable and runnable AgentV authoring primitive. An eval YAML file can be a reusable task suite that owns task context, a wrapper eval that imports suites and binds top-level runtime policy, or a sidecar around raw JSONL cases. AgentV does not have a separate runnable `experiment.yaml` artifact.

**Task suite** — Eval YAML that owns what is being tested: prompts, datasets, input files, fixtures, `workspace`, assertions, expected references, and judge criteria. It can run directly or be imported by another eval with `tests[].include` and `type: suite`.

**Raw case file** — YAML, JSONL, or directory case data imported with `tests: ./cases.yaml`, string shorthand, or `type: tests`. Raw cases are reusable data inputs; they do not carry imported suite context such as shared `workspace`, shared `input`, or shared `assertions`.

**Wrapper eval** — Eval YAML whose main job is to import task suites and bind top-level runtime policy such as target selection, repeat count, timeout, budget, and thresholds. Wrapper evals may live under an `experiments/` directory, but that path is an optional user-owned convention and AgentV does not infer behavior from it. A wrapper that imports suites with `type: suite` does not define parent `workspace`; imported suites own task environment.

**Experiment** — A string metadata/run-grouping label such as `baseline`, `candidate`, `with_skills`, or `without_skills`. It is not a runtime-policy object and not a result path namespace. Experiment is expressed as the reserved `tags.experiment` key (see **Tags**); there is no top-level `experiment` field. Runtime policy belongs in top-level eval fields or target objects; the experiment label is recorded in `summary.json` and `index.jsonl` for Dashboard grouping and comparison. Lifecycle setup belongs in `workspace.hooks` or `targets[].hooks`, not in a separate experiment artifact.

**Tags** — A promptfoo-shaped `Record<string,string>` map authored on an eval (or project config / `--tag key=value`) that labels a run with structured facets such as `experiment`, `team`, or `env`. The reserved `experiment` key feeds the experiment namespace. The resolved map is recorded in `summary.json` `metadata.tags` and every `index.jsonl` row, and the Dashboard "Tags" tab groups and compares runs by any tag key. This is the only "tags" concept: the earlier free-form manual per-run tag chips have been removed. (Suite-level `tags` may still be authored as a string list, which is a selection construct for `select.tags` / `--tag name` filtering rather than run metadata.)

**Workspace** — The task environment an eval prepares for the agent: repositories, templates, fixture files, and lifecycle hooks. It is not prompt input; use `input` for instructions and `workspace.repos[]` for multi-repo workspaces the agent can inspect or modify through tools.

**Run bundle** — A committed local result directory at `.agentv/results/<run_id>/`. `summary.json` records run metadata such as `run_id` and `experiment`; `index.jsonl` records per-case rows.

**Run manifest** — The root `summary.json` file in a run bundle. It owns aggregate run metadata and rollups such as `run_id`, `experiment`, timestamps, planned/completed counts, pass rate, score summaries, duration, tokens, and cost.

**Result index** — The root `index.jsonl` file in a run bundle. It is the dashboard and tooling loading contract for per-case result rows and artifact locations, including fields such as `result_dir`, `test_dir`, `summary_path`, and `grading_path`.

**Result source identity** — The stable source identity for a result row: repo-relative `eval_path`, `test_id`, and `target`. `suite` and `name` are display metadata, not storage or routing identity.

**Result directory** — The `result_dir` field in a `index.jsonl` row. It is a run-local directory allocation for that row's sidecars and outputs, usually a readable test-id or slug prefix plus a UUID/hash-like suffix. Consumers discover it from `index.jsonl` and must not infer it from suite names, display names, test IDs, targets, models, or folder position.

**Artifact sidecar** — A file beside or below a result directory that provides evidence for a result, such as `summary.json`, `grading.json`, `result.json`, transcripts, logs, or outputs. Sidecars are evidence, not the primary discovery mechanism for a run.

**Artifact attempt folder** — A per-case `run-N/` folder under a result directory. It stores one materialized execution's sidecars and outputs. It is not the primary comparison dimension: stochastic samples and infrastructure retries should be represented with explicit sample/retry metadata rather than inferred from `run-1`, `run-2`, and so on.

## Evaluation Reliability

**Repeat run** — A configured request to execute the same eval case and target more than once in the same run bundle. Repeat runs measure stochastic reliability, verifier stability, and drift; they are not the default CI path.

**Attempt** — One concrete execution inside a repeat run. Attempts keep their own score, status, timing, trace, transcript, logs, and artifacts so aggregate results never hide individual evidence.

**Pass rate** — Assertion or expectation pass rate inside a grading result: passed assertions or expectations divided by total assertions or expectations. AgentV does not use `pass_rate` for repeat-attempt success frequency.

**Attempt success rate** — Repeat-run reliability metric equal to successful counted attempts divided by counted attempts. This is distinct from `pass_rate`, which is reserved for assertion or expectation pass rate within a grading result.

**Gate policy** — The explicit rule that decides whether repeated attempts pass CI, such as `all_attempts_successful`, `any_attempt_successful`, `attempt_success_rate_at_least`, or `mean_pass_rate_at_least`. Without a repeat-run gate policy, AgentV preserves the normal single-run gate behavior and treats repeat statistics as report data.

**Flaky eval outcome** — A repeat-run aggregate whose attempts disagree, or whose failure classification points at verifier, infrastructure, or timeout instability rather than a stable model-quality failure.

## Release Channels

**Stable release** — A package publication channel whose surfaces are treated as compatibility commitments for normal users.

**Next tag** — A prerelease package channel used to validate upcoming AgentV surfaces before they become stable compatibility commitments.

Next-tag-only surfaces may be hard-corrected before stable release when preserving them would encode an unsafe or misleading contract. Stable-release surfaces need an explicit compatibility or migration strategy.
