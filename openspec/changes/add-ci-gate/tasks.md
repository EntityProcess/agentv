## 1. CLI Flag Implementation

- [ ] 1.1 Add `--fail-below` option to `apps/cli/src/commands/eval/index.ts` (number type, optional)
- [ ] 1.2 Add `--allow-errors` flag to `apps/cli/src/commands/eval/index.ts` (boolean flag)
- [ ] 1.3 Validate `--fail-below` is between 0.0 and 1.0, exit 1 with error message if invalid

## 2. Gate Logic Implementation

- [ ] 2.1 Count errored results in `run-eval.ts` (results with non-null `error` field)
- [ ] 2.2 Compute aggregate score using existing `calculateEvaluationSummary()` from `statistics.ts`
- [ ] 2.3 Implement exit code logic in `runEvalCommand()`:
  - Check errors first (exit 1 unless `--allow-errors`)
  - Then check threshold (exit 1 if score < threshold)
  - Exit 0 otherwise
- [ ] 2.4 Print gate summary messages:
  - "CI GATE FAILED: {N} eval case(s) errored - score is invalid"
  - "CI GATE FAILED: Score {actual} < threshold {threshold}"
  - "CI GATE PASSED: Score {actual} >= threshold {threshold}"
  - "Warning: {N} eval case(s) errored - continuing due to --allow-errors"

## 3. Testing

- [ ] 3.1 Test: `--fail-below 1.5` exits 1 with validation error
- [ ] 3.2 Test: eval with errors exits 1 by default
- [ ] 3.3 Test: eval with errors + `--allow-errors` continues to threshold check
- [ ] 3.4 Test: score 0.72 with `--fail-below 0.8` exits 1
- [ ] 3.5 Test: score 0.80 with `--fail-below 0.8` exits 0 (boundary)
- [ ] 3.6 Test: no flags + no errors exits 0 (backward compatibility)

## 4. Documentation

- [ ] 4.1 Update export-screening example to demonstrate native CI gate usage
- [ ] 4.2 Add flag descriptions to CLI help text
