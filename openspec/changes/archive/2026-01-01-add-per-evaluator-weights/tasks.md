## 1. Implementation

- [x] Update evaluator config types to support optional `weight` on evaluator entries.
- [x] Update YAML parser to accept `weight` and propagate it into the parsed evaluator configs.
- [x] Update evaluation aggregation logic to compute weighted mean across evaluator scores.
- [x] Include `weight` in `evaluator_results` output for each evaluator.
- [x] Add/update unit tests for:
  - [x] Default behavior (no weights) matches current unweighted mean.
  - [x] Weighted scoring produces expected overall score.
  - [x] Invalid weights (negative, NaN, non-numeric) are rejected or ignored per spec.
- [x] Update documentation/examples to show `weight` usage.

## 2. Validation

- [x] Run `bun run build`
- [x] Run `bun run typecheck`
- [x] Run `bun run lint`
- [x] Run `bun test`

## 3. Spec Compliance

- [ ] Ensure spec delta requirements are implemented.
- [ ] Run `openspec validate add-per-evaluator-weights --strict`
