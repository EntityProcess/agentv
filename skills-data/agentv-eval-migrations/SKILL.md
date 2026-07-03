---
name: agentv-eval-migrations
description: >-
  Migrate AgentV eval YAML across breaking schema changes, especially workspace
  contract updates and portable-vs-local runtime binding cleanup.
---

# AgentV Eval Migrations

Use this skill when updating existing AgentV eval YAML, examples, docs, or
generated eval authoring guidance after a schema-breaking change.

Before editing, read `references/breaking-changes.md`. For stale evals from
AgentV v4.42.4, use that reference as the migration map: it lists the
v4.42.4-era shape, current shape, migration steps, verification commands, and
compatibility notes for each major breaking authoring change. Then compare the
eval file against the current portable contract:

- Keep committed eval YAML portable: prompts, cases, assertions, workspace
  templates, repos, hooks, env checks, Docker preflight/container config, and
  `workspace.scope`.
- Do not put machine-local existing workspace directories in eval YAML. Use
  `--workspace-path` for one-off runs or `.agentv/config.local.yaml` with
  `execution.workspace_path` for persistent local binding.
- Use `workspace.scope: suite | attempt` for portable workspace lifetime. Docker
  config is not a replacement for workspace folder lifetime.
- Keep wire-format fields in `snake_case` and TypeScript internals in
  `camelCase`.

After migration, validate with `bun apps/cli/src/cli.ts validate <file>` when
working in the AgentV repo, or `agentv validate <file>` from an installed CLI.
Run the repo's parser/schema tests for generated examples and fixtures when the
change affects shared skill data or examples.
