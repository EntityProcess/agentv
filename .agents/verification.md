# Verification

This file expands [AGENTS.md](../AGENTS.md) for testing, manual UAT, CLI and browser verification, grader validation, and completion gates.

## CI Gates

- GitHub Actions is the authoritative merge gate.
- The `CI` workflow runs build, typecheck, lint, tests, marketplace checks, docs link checks, and eval schema validation on pushes to `main`, pull requests to `main`, and manual dispatches.
- Run the same core checks locally when you need fast feedback:

```bash
bun run verify
bun run validate:examples
```

- Task tracker sync is operator-supplied. If the prompt provides an external tracker sync or flush command, run it exactly as instructed and keep exported tracker state out of AgentV commits unless explicitly requested.
- NTM hooks are optional local coordination tooling. Do not commit generated hook files or local `.ntm/config.toml`.
- If an existing checkout has NTM or prek hooks installed, restore Git's default hook path:

```bash
git config --unset core.hooksPath
```

## Functional Testing the CLI

- Never use `agentv` directly for functional testing. It may resolve to a globally installed version.
- Preferred: `bun apps/cli/src/cli.ts <args>`. This always runs the current CLI source.
- Exception: changes inside `packages/core/` require `bun run build` first because the CLI imports `@agentv/core` from compiled `dist/`.
- `bun apps/cli/dist/cli.js <args>` also works, but only after `bun run build`, and it can go stale.
- `bun agentv <args>` runs the locally built version and also requires a build.
- Prefer running from source during development. Rebuild after pulling changes that touch `packages/core/`.

## Browser E2E for Docs and Dashboard

- Use `agent-browser` for visual verification of docs-site and Dashboard changes.
- Always use `--session <name>` so browser instances stay isolated.
- Never use `--headed`; there is no display server.
- Rebuild `apps/dashboard/dist/` before Dashboard UAT, even if you only changed backend or docs code:

```bash
cd apps/dashboard && bun run build
```

- Running `agentv dashboard` from source reloads the CLI and backend routes, but the Dashboard web UI is served from the static `apps/dashboard/dist/` bundle. If you skip the rebuild, you can silently test stale UI code.
- Save browser screenshots and other visual UAT artifacts outside the public AgentV repo, then publish them to the private evidence repo on a reviewable branch:

```bash
agentv-private:evidence/<bead-or-feature-slug>
```

- Use the existing `agentv-private` checkout or remote when available; do not commit screenshot evidence to the public repo.
- Include a short README or manifest on the evidence branch with the public PR link, source branch, capture date, and what each artifact shows.
- Include the private evidence branch, commit, or PR link in the public PR description and tracker handoff.

If `agent-browser --session <name> open <url>` hangs with EAGAIN on ARM64, pre-start Chrome and connect with CDP:

```bash
nohup chromium --headless=new --remote-debugging-port=9222 \
  --no-first-run --disable-background-networking --disable-default-apps \
  --disable-sync --ozone-platform=headless --window-size=1280,720 \
  --user-data-dir=/tmp/ab-chrome > /tmp/chrome.log 2>&1 &
curl -s http://localhost:9222/json/version

agent-browser --cdp 9222 open <url>
agent-browser --cdp 9222 screenshot output.png
```

## Agent Provider Eval Concurrency

- When running evals against agent-provider targets such as `claude`, `claude-sdk`, `codex`, `copilot`, `copilot-sdk`, `pi`, or `pi-cli`, limit concurrency to 3 targets at a time.
- These providers spawn heavyweight subprocesses and can exhaust system resources if you run too many in parallel.

```bash
bun apps/cli/src/cli.ts eval my.EVAL.yaml --target claude &
bun apps/cli/src/cli.ts eval my.EVAL.yaml --target codex &
wait
bun apps/cli/src/cli.ts eval my.EVAL.yaml --target copilot &
bun apps/cli/src/cli.ts eval my.EVAL.yaml --target pi &
wait
```

- This limit does not apply to lightweight LLM-only targets such as `azure`, `openai`, `gemini`, or `openrouter`.

## Writing Tests

- Only test new or changed behavior.
- Protect stable core contracts such as data formats, scoring semantics, routing, persistence, provider contracts, and CLI or API outcomes users depend on.
- One test per distinct behavior.
- Skip tests for obvious one-line behavior unless it is a regression risk.
- Prefer regression tests over broad happy-path matrices.
- When end-user behavior matters but churns often, prefer updating the public docs in `apps/web/src/content/docs/` over locking temporary behavior into brittle tests.
- Tests are executable contracts. If the contract changes, update the tests to match the new promise.

## Verifying Grader Changes

Unit tests alone are not enough for grader changes.

1. If you are in a git worktree, copy `.env` into the worktree root before claiming E2E or grader verification:

```bash
cp /path/to/main/.env .env
```

```powershell
Copy-Item D:/path/to/main/.env .env
```

2. Run a real eval with a real example file:

```bash
bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id <test-id>
```

3. Inspect the results JSONL and verify:

- the correct grader type ran by checking `scores[].type`
- scores are calculated as expected
- the `assertions` array reflects the evaluation logic

4. Update baseline files if output format changes. Baselines live next to eval YAML files as `*.baseline.jsonl`.
5. `--dry-run` returns schema-valid mock responses, but the scores are not meaningful. Use it only for plumbing and harness checks.

## Live Dogfood for Eval and Experiment Changes

Use live dogfood before marking PRs ready when they affect eval execution, experiments, repeat runs, targets, providers, graders, or artifact provenance.

- Live means both sides are real: a live agent/provider target and a live grader target. Do not count `mock`, `--dry-run`, or deterministic-only assertions as dogfood for these changes.
- Prefer the smallest realistic eval: one or two cases, bounded timeouts, and `workers: 1` for heavyweight agent providers.
- For native experiment changes, run through `agentv eval run ... --experiment <experiment.yaml|ts>` so resolution, setup, scripts, target selection, run knobs, and artifact metadata are exercised together.
- For repeat-run changes, use an experiment-level repeat config with `count >= 2`, `early_exit: false` when validating all attempts are persisted. Inspect root `index.jsonl`, root `benchmark.json`, and the repeated case folder. The repeated case folder should carry aggregate `summary.json` with flattened snake_case timing fields plus AgentV aggregate `grading.json`; attempt-specific outputs, transcripts, and metrics live under `run-N/`. Each `run-N/` folder should contain `result.json`, `grading.json`, `metrics.json`, `transcript.jsonl`, `transcript-raw.jsonl`, and `outputs/answer.md` when answer output is available. `result.json` should point at `./grading.json`, `./metrics.json`, `./transcript.jsonl`, and `./transcript-raw.jsonl` through the corresponding path fields.
- For local OpenAI-compatible grading through the OAuth proxy, use `endpoint: http://127.0.0.1:10531/v1`, but still route `api_key` and `model` through environment references such as `${{ LOCAL_OPENAI_PROXY_API_KEY }}` and `${{ LOCAL_OPENAI_PROXY_MODEL }}`. Literal secrets and literal model values are intentionally rejected by target validation unless a resolver explicitly allows them.
- For `codex`/Codex SDK live dogfood through the same local proxy, configure the agent target with `provider: codex`, `base_url: ${{ LOCAL_OPENAI_PROXY_BASE_URL }}`, `api_key: ${{ LOCAL_OPENAI_PROXY_API_KEY }}`, `model: ${{ LOCAL_OPENAI_PROXY_MODEL }}`, `api_format: responses`, `grader_target: <local-openai-grader>`, `workers: 1`, and a bounded `timeout_seconds`. Configure the grader target as `provider: openai`, `api_format: chat`, and the same local proxy env references. A minimal run should use `bun apps/cli/src/cli.ts eval run <eval.yaml> --targets <targets.yaml> --target <codex-target> --workers 1`.
- If the local proxy returns `401 token_expired`, the blocker is stale Codex OAuth, not AgentV target configuration. Refresh from a trusted local terminal with `codex logout`, `codex login --device-auth`, then restart `openai-oauth` and rerun the same eval command.
- Preserve review evidence in `agentv-private` on an `evidence/<bead-or-feature-slug>` branch. Include the run bundle, source eval/experiment/targets files, a short README, an artifact tree, and screenshots when folder structure or UI behavior is under review.
- If comparing against an external convention such as Vercel `agent-eval`, verify both semantic provenance and the physical `run-N` artifact layout for repeat runs.
- For transcript/result artifact contract changes, try the same provider spread before merging: `pi-cli`, `codex-sdk`, and `copilot-sdk` through the local OpenAI-compatible endpoint when available. If a provider cannot run live, record the exact blocker, the run bundle or command output, and whether coverage moved to fixture/regression tests.
- If dogfood or review changes the durable verification playbook, update this file or `AGENTS.md` in the same PR. Use `docs/solutions/` for longer reusable lessons rather than relying on PR comments or private evidence as the only source.

## Checking Grader Score Ranges

Use `scripts/check-grader-scores.ts` as a post-processor after an eval run.

Workflow:

```bash
bun apps/cli/src/cli.ts eval examples/path/to/suite.eval.yaml --target azure \
  --output examples/path/to/suite.run

bun scripts/check-grader-scores.ts
```

- The script auto-discovers `examples/**/*.grader-scores.yaml`, finds the sibling `*.results.jsonl`, and exits non-zero if any score is out of range.
- To add checks for a new eval, create `<eval-stem>.grader-scores.yaml` next to the eval YAML, add the `(test_id, grader, range)` entries you care about, then run the eval and the checker.
- `grader` must match a `scores[].name` value in the JSONL output. `range.min` and `range.max` default to `0` and `1` if omitted.

## Completion Checklist

Before marking a branch ready for review:

1. Preflight: if in a git worktree, ensure `.env` exists in the worktree root.

```bash
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
```

2. Run unit tests with `bun run test`.
3. Blocking manual red and green UAT:

- Red: run the scenario on `main` or the pre-change state and confirm the bug or missing feature is observable.
- Green: run the identical scenario on your branch and confirm the fix or feature works from the end user's perspective.
- Document both red and green evidence in the PR description or comments.

4. Verify no regressions in adjacent areas.
5. For scoring, threshold, or grader changes, run at least one real eval with a live provider and verify the output JSONL.
6. For Dashboard config, scoring-display, or dashboard API changes, use `agent-browser` to verify the UI still renders and behaves correctly.
7. If visual evidence was captured, push it to an `agentv-private` evidence branch and include the resulting branch, commit, or PR link in the handoff.
8. Mark the PR ready only after the checklist is complete and the red or green evidence is attached.
