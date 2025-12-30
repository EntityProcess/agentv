## 1. Implementation

- [ ] 1.1 Add `--fail-below` option to `apps/cli/src/commands/eval/index.ts`
- [ ] 1.2 Add `--allow-errors` flag to `apps/cli/src/commands/eval/index.ts`
- [ ] 1.3 Track error count in `run-eval.ts` during evaluation
- [ ] 1.4 Compute aggregate score from results in `run-eval.ts`
- [ ] 1.5 Implement exit code logic: error check first, then threshold check
- [ ] 1.6 Add summary output indicating pass/fail reason when gate is active

## 2. Testing

- [ ] 2.1 Add unit test: exits 1 when any eval case has error (default behavior)
- [ ] 2.2 Add unit test: exits 0 with `--allow-errors` even when errors present
- [ ] 2.3 Add unit test: exits 1 when score below `--fail-below` threshold
- [ ] 2.4 Add unit test: exits 0 when score meets `--fail-below` threshold
- [ ] 2.5 Add unit test: error check runs before threshold check

## 3. Documentation

- [ ] 3.1 Update export-screening README to show native CI gate usage
- [ ] 3.2 Add CI gate example to CLI help text
