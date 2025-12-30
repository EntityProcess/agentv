## 1. CLI Flag Implementation

- [x] 1.1 Add `--fail-below` option to `apps/cli/src/commands/eval/index.ts` (number type, optional)
- [x] 1.2 Validate `--fail-below` is between 0.0 and 1.0, exit 1 with error message if invalid

## 2. Gate Logic Implementation

- [x] 2.1 Count errored results in `run-eval.ts` (results with non-null `error` field)
- [x] 2.2 Compute aggregate score using existing `calculateEvaluationSummary()` from `statistics.ts`
- [x] 2.3 Implement exit code logic in `runEvalCommand()`:
  - Check errors first (exit 1 if any)
  - Then check threshold (exit 1 if score < threshold)
  - Exit 0 otherwise
- [x] 2.4 Print gate summary messages:
  - "CI GATE FAILED: {N} eval case(s) errored - score is invalid"
  - "CI GATE FAILED: Score {actual} < threshold {threshold}"
  - "CI GATE PASSED: Score {actual} >= threshold {threshold}"

## 3. Testing

- [x] 3.1 Test: `--fail-below 1.5` exits 1 with validation error
- [x] 3.2 Test: eval with errors exits 1
- [x] 3.3 Test: score 0.72 with `--fail-below 0.8` exits 1
- [x] 3.4 Test: score 0.80 with `--fail-below 0.8` exits 0 (boundary)
- [x] 3.5 Test: no flags + no errors exits 0 (backward compatibility)

## 4. Documentation

- [x] 4.1 Update export-screening example to demonstrate native CI gate usage
- [x] 4.2 Add flag descriptions to CLI help text
