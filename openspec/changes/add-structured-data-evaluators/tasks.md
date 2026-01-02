# Implementation Tasks: Add Structured Data Evaluators

**Change ID:** `add-structured-data-evaluators`

This tasks file provides an ordered implementation checklist. Complete items sequentially and mark them done as you go.

## Scope Note

This proposal focuses on the `field_accuracy` evaluator only. Geometric evaluators (IoU, coordinate distance) are deferred to `code_judge` plugins. See [geometric-evaluators/spec.md](specs/geometric-evaluators/spec.md) for ready-to-use Python scripts.

## Phase 1: Spec Deltas & Design (Planning)

- [x] **Task 1.1**: Draft spec delta for `structured-data-evaluators` capability
  - Define requirements for field_accuracy evaluator
  - Specify match types (exact, fuzzy, numeric_tolerance, date)
  - Document field path syntax (dot notation)
  - Include scenarios for weighted aggregation

- [x] **Task 1.2**: Document geometric evaluators as plugin approach
  - Create spec with ready-to-use Python `code_judge` scripts
  - Document IoU calculation for xyxy format
  - Document distance metrics (euclidean, manhattan, cosine)
  - Explain rationale for deferring to plugins

- [ ] **Task 1.3**: Create design.md documenting architectural decisions
  - Explain evaluator registration pattern
  - Document field path resolution strategy
  - Explain scoring aggregation approaches
  - Address performance considerations
  - Document error handling patterns

- [ ] **Task 1.4**: Update `yaml-schema` spec with new evaluator types
  - Add `field_accuracy` to evaluator type union
  - Document configuration options for field_accuracy

## Phase 2: Core Implementation

- [ ] **Task 2.1**: Implement `FieldAccuracyEvaluator` class in `packages/core/src/evaluation/evaluators.ts`
  - Implement base evaluator interface
  - Add field path resolver using lodash `get` or custom implementation
  - Implement exact match strategy
  - Add unit tests for exact matching

- [ ] **Task 2.2**: Add fuzzy matching support to `FieldAccuracyEvaluator`
  - Implement Levenshtein distance algorithm
  - Implement Jaro-Winkler distance algorithm
  - Add threshold-based scoring
  - Add unit tests for fuzzy matching

- [ ] **Task 2.3**: Add numeric tolerance support to `FieldAccuracyEvaluator`
  - Implement absolute tolerance comparison
  - Implement relative tolerance comparison (percentage-based)
  - Handle edge cases (null, undefined, non-numeric values)
  - Add unit tests for numeric tolerance

- [ ] **Task 2.4**: Add date matching support to `FieldAccuracyEvaluator`
  - Implement date parsing for common formats:
    - ISO: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss`
    - US: `MM/DD/YYYY`, `MM-DD-YYYY`
    - EU: `DD/MM/YYYY`, `DD-MM-YYYY`
    - Localized: `DD-MMM-YYYY` (e.g., "15-JAN-2025")
  - Normalize to epoch timestamp for comparison
  - Handle date-only comparison (ignore time component)
  - Handle unparseable dates gracefully
  - Add unit tests for date matching

- [ ] **Task 2.5**: Implement aggregation strategies for `FieldAccuracyEvaluator`
  - Implement weighted_average aggregation
  - Implement all_or_nothing aggregation
  - Generate hits/misses arrays
  - Add unit tests for aggregation

## Phase 3: Schema & Validation

- [ ] **Task 3.1**: Extend YAML schema types in `packages/core/src/evaluation/types.ts`
  - Add `FieldAccuracyEvaluatorConfig` type
  - Add `FieldMatchType` enum (exact, fuzzy, numeric_tolerance, date)
  - Update `EvaluatorConfig` union type
  - Update `EvaluatorKind` literals

- [ ] **Task 3.2**: Add Zod validation schemas in `packages/core/src/evaluation/validation/`
  - Create field_accuracy schema
  - Validate match type enum
  - Validate threshold is present for fuzzy matching
  - Validate tolerance is present for numeric matching
  - Validate formats array for date matching
  - Add validation error messages
  - Add unit tests for schema validation

- [ ] **Task 3.3**: Update YAML parser in `packages/core/src/evaluation/yaml-parser.ts`
  - Register field_accuracy evaluator type
  - Add configuration resolution logic
  - Handle relative path resolution for nested fields
  - Add integration tests for YAML parsing

## Phase 4: Integration & Testing

- [ ] **Task 4.1**: Verify example eval files in `examples/features/document-extraction/`
  - Verify invoice extraction example with field_accuracy works
  - Test all match types (exact, fuzzy, numeric, date)
  - Include ground truth data and expected results

- [ ] **Task 4.2**: Add integration tests in `packages/core/test/integration/`
  - Test end-to-end invoice field extraction evaluation
  - Test date format normalization across formats
  - Test error handling and edge cases
  - Test performance benchmarks (<10ms per field)

- [ ] **Task 4.3**: Update orchestrator to register new evaluator
  - Add evaluator factory logic in `packages/core/src/evaluation/orchestrator.ts`
  - Ensure evaluator receives correct context
  - Verify evaluation results structure
  - Add integration tests for orchestrator

## Phase 5: Documentation

- [ ] **Task 5.1**: Update main README.md
  - Add structured data evaluators to feature list
  - Link to detailed documentation
  - Include quick start example

- [ ] **Task 5.2**: Create structured data evaluation guide in `docs/`
  - Document field_accuracy evaluator with examples
  - Document match types and when to use each
  - Explain date format handling
  - Include best practices for structuring eval cases
  - Link to geometric evaluators plugin examples

- [ ] **Task 5.3**: Update CLI help documentation
  - Ensure field_accuracy evaluator type appears in help text
  - Add examples to CLI documentation
  - Update schema reference docs

## Phase 6: Quality Assurance

- [ ] **Task 6.1**: Run full test suite
  - Execute `bun test` and ensure all tests pass
  - Verify test coverage >90% for new code
  - Fix any failing tests

- [ ] **Task 6.2**: Run quality checks
  - Execute `bun run build` (no compilation errors)
  - Execute `bun run typecheck` (no type errors)
  - Execute `bun run lint` (no style violations)
  - Fix any issues found

- [ ] **Task 6.3**: Performance benchmarking
  - Benchmark field comparison (<10ms target)
  - Benchmark date parsing performance
  - Benchmark batch operations
  - Document results and optimize if needed

- [ ] **Task 6.4**: Manual functional testing
  - Test with document extraction use case
  - Verify error messages are helpful
  - Test with various date formats
  - Test with fuzzy matching edge cases

## Phase 7: Finalization

- [ ] **Task 7.1**: Create changeset
  - Run `bun changeset`
  - Select minor version bump (new features)
  - Write comprehensive changelog entry
  - Commit changeset file

- [ ] **Task 7.2**: Update proposal status
  - Mark all tasks as complete
  - Update proposal status to "Implemented"
  - Document any deviations from original plan

- [ ] **Task 7.3**: Prepare for archive
  - Ensure all specs are updated
  - Verify change is ready for production
  - Plan archive date post-deployment

## Dependencies

- **Parallel Work**: Tasks 2.1-2.5 can be implemented in parallel after Task 1.4
- **Blocking**: Phase 3 requires Phase 2 completion
- **Blocking**: Phase 4 requires Phase 3 completion
- **Parallel Work**: Phase 5 can start alongside Phase 4

## Success Validation

Before marking this change complete, verify:

✅ All tests pass (`bun test`)
✅ No type errors (`bun run typecheck`)
✅ No lint violations (`bun run lint`)
✅ Performance targets met (<10ms per field)
✅ Example eval files execute successfully
✅ Date matching handles common formats
✅ Documentation is complete and accurate
✅ Changeset created with appropriate version bump
