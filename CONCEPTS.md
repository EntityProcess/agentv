# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Providers and Targets

**Provider** — an adapter plugin that connects AgentV's evaluation engine to a specific AI system (e.g., copilot CLI, copilot SDK, Claude API, pi). Each provider implements the request/response contract: given a test case, invoke the AI system and return its output. Providers are selected per-target in eval YAML and can be extended via the provider registry.

**Target** — the eval YAML declaration that activates a specific provider for an evaluation run. A target names the provider, supplies configuration (model, API keys, timeouts, passthrough args), and scopes to a subset of test cases when needed. A single eval file can declare multiple targets to compare AI systems side by side.

**Provider runtime boundary** — the process boundary between AgentV's evaluation orchestrator and the agent runtime a provider invokes. CLI-backed providers place the agent runtime outside the orchestrator; in-process SDK providers share the orchestrator process and need either a targeted transport fix or subprocess-style isolation when runtime teardown can threaten run artifact finalization.

## Evaluation Reliability

**Repeat run** — A configured request to execute the same eval case and target more than once in the same timestamped run bundle. Repeat runs measure stochastic reliability, verifier stability, and drift; they are not the default CI path.

**Attempt** — One concrete execution inside a repeat run. Attempts keep their own score, status, timing, trace, transcript, logs, and artifacts so aggregate results never hide individual evidence.

**Pass rate** — Assertion or expectation pass rate inside a grading result: passed assertions or expectations divided by total assertions or expectations. AgentV does not use `pass_rate` for repeat-attempt success frequency.

**Attempt success rate** — Repeat-run reliability metric equal to successful counted attempts divided by counted attempts. This is distinct from `pass_rate`, which is reserved for assertion or expectation pass rate within a grading result.

**Gate policy** — The explicit rule that decides whether repeated attempts pass CI, such as `all_attempts_successful`, `any_attempt_successful`, `attempt_success_rate_at_least`, or `mean_pass_rate_at_least`. Without a repeat-run gate policy, AgentV preserves the normal single-run gate behavior and treats repeat statistics as report data.

**Flaky eval outcome** — A repeat-run aggregate whose attempts disagree, or whose failure classification points at verifier, infrastructure, or timeout instability rather than a stable model-quality failure.
