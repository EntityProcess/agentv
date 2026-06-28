---
name: agentv-eval-migrations
description: >-
  Migrate AgentV eval YAML across breaking schema changes, especially workspace
  contract updates and portable-vs-local runtime binding cleanup.
---

# AgentV Eval Migrations

Use this skill when updating existing AgentV eval YAML, examples, docs, or
generated eval authoring guidance after a schema-breaking change.

Before editing, read `references/breaking-changes.md` and compare the eval file
against the current portable contract:

- Keep committed eval YAML portable: prompts, cases, assertions, workspace
  templates, repos, hooks, env checks, Docker preflight/container config, and
  `workspace.isolation`.
- Do not put machine-local existing workspace directories in eval YAML. Use
  `--workspace-path` for one-off runs or `.agentv/config.local.yaml` with
  `execution.workspace_path` for persistent local binding.
- Use `workspace.isolation: shared | per_case` for folder isolation. Docker
  config is not a replacement for workspace folder isolation.
- Keep wire-format fields in `snake_case` and TypeScript internals in
  `camelCase`.

After migration, validate with `agentv eval <file> --dry-run` when possible, or
run the repo's parser/schema tests for generated examples and fixtures.
