## 1. Implementation

- [ ] Update evaluator config types to support optional `weight` on evaluator entries.
- [ ] Update YAML parser to accept `weight` and propagate it into the parsed evaluator configs.
- [ ] Update evaluation aggregation logic to compute weighted mean across evaluator scores.
- [ ] Include `weight` in `evaluator_results` output for each evaluator.
- [ ] Add/update unit tests for:
  - [ ] Default behavior (no weights) matches current unweighted mean.
  - [ ] Weighted scoring produces expected overall score.
  - [ ] Invalid weights (negative, NaN, non-numeric) are rejected or ignored per spec.
- [ ] Update documentation/examples to show `weight` usage.

## 2. Validation

- [ ] Run `bun run build`
- [ ] Run `bun run typecheck`
- [ ] Run `bun run lint`
- [ ] Run `bun test`

## 3. Spec Compliance

- [ ] Ensure spec delta requirements are implemented.
- [ ] Run `openspec validate add-per-evaluator-weights --strict`
