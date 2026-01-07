# Change: Enable code_judge to call the configured judge target (via local proxy)

## Why

Some evaluators (e.g., RAG contextual precision) need **multiple judge calls per eval case**.
Today `code_judge` runs as an external script (stdin/stdout) and cannot reuse AgentV’s configured judge target, forcing authors to bring their own API keys and potentially diverging from the configured model routing.

## What Changes

- **ADDED**: Optional `use_judge_provider: true` for `code_judge` evaluators.
- **ADDED**: A local, per-invocation **judge proxy** that allows a `code_judge` script to request judge invocations without receiving provider credentials.
- **ADDED**: `@agentv/eval` helper to create a judge client from environment (`AGENTV_JUDGE_PROXY_URL`, `AGENTV_JUDGE_PROXY_TOKEN`).
- **ADDED**: Basic safety controls (auth token, loopback-only binding, max call limit).

## Impact

- Affected specs:
  - `evaluation` (new behavior for `code_judge` when opt-in is enabled)
  - `yaml-schema` (schema accepts new optional fields)
- Affected code (expected):
  - `packages/core/src/evaluation/evaluators.ts` (code_judge invocation wrapper)
  - `packages/core/src/runtime/exec.ts` (child process env injection)
  - `packages/eval/src/*` (SDK helper client)
- Compatibility:
  - Existing `code_judge` evaluators remain unchanged by default.
  - Proxy is opt-in and only enabled per evaluator.

## Notes on prior findings

A prior proposal suggested passing judge provider config (including API keys) to scripts via environment variables.
This change rejects that approach as the default because it increases credential exfiltration risk and makes cost/limits harder to enforce.
