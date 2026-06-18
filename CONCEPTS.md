# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Providers and Targets

**Provider** — an adapter plugin that connects AgentV's evaluation engine to a specific AI system (e.g., copilot CLI, copilot SDK, Claude API, pi). Each provider implements the request/response contract: given a test case, invoke the AI system and return its output. Providers are selected per-target in eval YAML and can be extended via the provider registry.

**Target** — the eval YAML declaration that activates a specific provider for an evaluation run. A target names the provider, supplies configuration (model, API keys, timeouts, passthrough args), and scopes to a subset of test cases when needed. A single eval file can declare multiple targets to compare AI systems side by side.
