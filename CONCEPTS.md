# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Providers and Targets

**Provider** — an adapter plugin that connects AgentV's evaluation engine to a specific AI system (e.g., copilot CLI, copilot SDK, Claude API, pi). Each provider implements the request/response contract: given a test case, invoke the AI system and return its output. Providers are selected per-target in eval YAML and can be extended via the provider registry.

**Target** — the eval YAML declaration that activates a specific provider for an evaluation run. A target names the provider, supplies configuration (model, API keys, timeouts, passthrough args), and scopes to a subset of test cases when needed. A single eval file can declare multiple targets to compare AI systems side by side.

**Provider runtime boundary** — the process boundary between AgentV's evaluation orchestrator and the agent runtime a provider invokes. CLI-backed providers place the agent runtime outside the orchestrator; in-process SDK providers share the orchestrator process and need either a targeted transport fix or subprocess-style isolation when runtime teardown can threaten run artifact finalization.

## Evaluation Model

**Eval** — The frozen task and grading definition: prompts, datasets, input files, fixtures, assertions, and judge criteria. An eval defines what is being tested, not which agent, model, setup variant, or run policy executes it.

**Experiment** — A committed run variant that selects how evals are executed: target or target matrix, setup, scripts, eval filters, repeat counts, timeouts, workers, budgets, and related run knobs. Experiments make A/B setup differences explicit while pointing at stable eval tasks.

**Run manifest** — The root `index.jsonl` file in a run bundle. It is the dashboard and tooling loading contract for per-case result rows and artifact locations, including fields such as `result_dir`, `task_dir`, `summary_path`, and `grading_path`.

**Result source identity** — The stable source identity for a result row: repo-relative `eval_path`, `test_id`, and `target`. `suite` and `name` are display metadata, not storage or routing identity.

**Result directory** — The `result_dir` field in an `index.jsonl` row. It is a run-local directory allocation for that row's sidecars and outputs. Consumers discover it from `index.jsonl` and must not infer it from suite names, display names, test IDs, or targets.

**Artifact sidecar** — A file beside or below a result directory that provides evidence for a result, such as `summary.json`, `grading.json`, `result.json`, transcripts, logs, or outputs. Sidecars are evidence, not the primary discovery mechanism for a run.

## Evaluation Reliability

**Repeat run** — A configured request to execute the same eval case and target more than once in the same timestamped run bundle. Repeat runs measure stochastic reliability, verifier stability, and drift; they are not the default CI path.

**Attempt** — One concrete execution inside a repeat run. Attempts keep their own score, status, timing, trace, transcript, logs, and artifacts so aggregate results never hide individual evidence.

**Pass rate** — Assertion or expectation pass rate inside a grading result: passed assertions or expectations divided by total assertions or expectations. AgentV does not use `pass_rate` for repeat-attempt success frequency.

**Attempt success rate** — Repeat-run reliability metric equal to successful counted attempts divided by counted attempts. This is distinct from `pass_rate`, which is reserved for assertion or expectation pass rate within a grading result.

**Gate policy** — The explicit rule that decides whether repeated attempts pass CI, such as `all_attempts_successful`, `any_attempt_successful`, `attempt_success_rate_at_least`, or `mean_pass_rate_at_least`. Without a repeat-run gate policy, AgentV preserves the normal single-run gate behavior and treats repeat statistics as report data.

**Flaky eval outcome** — A repeat-run aggregate whose attempts disagree, or whose failure classification points at verifier, infrastructure, or timeout instability rather than a stable model-quality failure.

## Release Channels

**Stable release** — A package publication channel whose surfaces are treated as compatibility commitments for normal users.

**Next tag** — A prerelease package channel used to validate upcoming AgentV surfaces before they become stable compatibility commitments.

Next-tag-only surfaces may be hard-corrected before stable release when preserving them would encode an unsafe or misleading contract. Stable-release surfaces need an explicit compatibility or migration strategy.
