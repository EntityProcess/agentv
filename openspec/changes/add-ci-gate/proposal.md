# Change: Add Native CI Gate Support

## Why

Currently, `agentv eval` always exits with code 0 regardless of evaluation results. CI/CD pipelines require wrapper scripts (like `ci_check.py` in export-screening) to:
1. Parse results and compute thresholds
2. Return appropriate exit codes
3. Handle errors that invalidate scores

This creates friction for users who want out-of-the-box CI integration. The evaluation framework should natively support quality gates.

## What Changes

- Add `--fail-below <score>` CLI flag to fail when aggregate score is below threshold
- **Exit 1 by default if any eval case errors** (errors invalidate the score)
- Add `--allow-errors` flag to opt-out of error-based failures (dangerous, use with caution)
- Exit codes: 0 = pass, 1 = fail (threshold or errors)

## Impact

- Affected specs: `eval-cli`
- Affected code: `apps/cli/src/commands/eval/index.ts`, `apps/cli/src/commands/eval/run-eval.ts`
- No breaking changes (current behavior requires explicit `--fail-below` to enable)
