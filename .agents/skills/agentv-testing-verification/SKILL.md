---
name: agentv-testing-verification
description: Use when testing, verifying, debugging checks, changing CLI behavior, grader behavior, Studio UI/API behavior, docs site visuals, examples, or preparing an AgentV PR for review.
---

# AgentV Testing and Verification

## Pre-Push

The repo uses `prek` pre-push hooks. Do not manually run the full pre-push suite before pushing unless diagnosing a failure. Push to the feature branch and let the hook run:

- `bun run build`
- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run validate:examples`

Manual equivalent:

```bash
bunx prek run --all-files --hook-stage pre-push
```

## CLI Testing

Never use global `agentv` for functional testing. Use current source:

```bash
bun apps/cli/src/cli.ts <args>
```

If changes touch `packages/core/`, run `bun run build` first because the CLI imports `@agentv/core` from compiled `dist`.

For built output use `bun apps/cli/dist/cli.js <args>` or `bun agentv <args>`, but only after building.

## Studio UI

`agentv studio` serves `apps/studio/dist/`. Rebuild before UAT or screenshots:

```bash
cd apps/studio && bun run build
```

## Docs Browser E2E

Use `agent-browser` for docs site verification. Always pass `--session <name>` and do not use `--headed`.

If session launch hangs with EAGAIN on ARM64, pre-start Chrome with CDP and use `agent-browser --cdp 9222`.

## Agent Provider Evals

Limit coding-agent provider eval concurrency to 3 targets at a time for `claude`, `claude-sdk`, `codex`, `copilot`, `copilot-sdk`, `pi`, and `pi-cli`. Lightweight LLM-only targets can use higher concurrency.

## Writing Tests

- Test new or changed behavior only.
- Prefer one test per distinct behavior.
- Avoid tests for obvious one-line behavior unless it is a regression risk.
- Regression tests matter more than broad happy-path duplication.
- Tests are executable contracts; update them when behavior promises change.

## Completion Checklist

Before marking a branch ready:

- Ensure `.env` exists in a worktree when evals or LLM-dependent tests may run.
- Run targeted tests while developing and rely on pre-push for the full suite.
- Complete manual red/green UAT for user-facing behavior before review readiness.
- Verify adjacent behavior where the change touches shared parsing, scoring, config, or UI paths.
- For scoring/grader changes, run at least one real eval with a live provider when feasible.
- For Studio UX/API changes, verify with browser testing.
- Document verification evidence in the PR.
