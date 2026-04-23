# Plan: hooks.pre_run — pre-eval environment injection

Issue: #1149

## Problem

Users who fetch secrets at runtime (e.g. from Azure Key Vault, AWS Secrets Manager) must wrap the
`agentv` CLI in a project-level script. A generic `hooks.pre_run` config option removes this need.

## Implementation

### Files changed

| File | Change |
|------|--------|
| `packages/core/src/evaluation/hooks.ts` | New — `parseEnvOutput()` and `runPreRunHook()` |
| `packages/core/src/evaluation/config.ts` | Add `hooks.preRun` to Zod schema + TS type |
| `packages/core/src/evaluation/loaders/config-loader.ts` | Add `HooksConfig` type + `parseHooksConfig()` + wire into `loadConfig()` |
| `packages/core/src/index.ts` | Export `runPreRunHook`, `parseEnvOutput` |
| `apps/cli/src/commands/eval/run-eval.ts` | Import `runPreRunHook`; call before `normalizeOptions` |
| `plugins/agentv-dev/skills/agentv-eval-writer/references/config-schema.json` | Add `hooks.pre_run` to JSON schema |
| `packages/core/test/evaluation/hooks.test.ts` | New — unit tests for `parseEnvOutput` |

### Precedence

YAML config (`hooks.pre_run`) takes precedence over TS config (`hooks.preRun`). This matches the
existing pattern for other settings.

### Env var injection rules

- Parses `export KEY="value"` (shell export) and `KEY=value` (dotenv) from stdout
- Existing env vars are NOT overwritten — process.env always wins
- Non-zero exit throws, aborting the eval
- Stderr forwarded to process.stderr so users see hook output

## Docs to update before merge

- `apps/web/src/content/docs/` — add `hooks.pre_run` to the config reference page
- Delete this plan file
