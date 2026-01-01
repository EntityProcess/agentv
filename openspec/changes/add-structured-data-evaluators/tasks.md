# Implementation Tasks: Add Structured Data Evaluators

**Change ID:** `add-structured-data-evaluators`

This tasks file provides an ordered implementation checklist. Complete items sequentially and mark them done as you go.

## Phase 1: Spec Deltas & Design (Planning)

- [ ] **Task 1.1**: Draft spec delta for `structured-data-evaluators` capability
  - Define requirements for field_accuracy evaluator
  - Specify match types (exact, fuzzy, numeric_tolerance)
  - Document field path syntax (dot notation)
  - Include scenarios for weighted aggregation
  - Add scenarios for precision/recall/F1 metrics

- [ ] **Task 1.2**: Draft spec delta for `geometric-evaluators` capability
  - Define requirements for iou_score evaluator
  - Define requirements for coordinate_distance evaluator
  - Specify supported bbox formats (xyxy, xywh, polygon)
  - Include scenarios for batch evaluation
  - Document distance metrics (euclidean, manhattan, cosine)

- [ ] **Task 1.3**: Create design.md documenting architectural decisions
  - Explain evaluator registration pattern
  - Document field path resolution strategy
  - Explain scoring aggregation approaches
  - Address performance considerations
  - Document error handling patterns

- [ ] **Task 1.4**: Update `yaml-schema` spec with new evaluator types
  - Add `field_accuracy` to evaluator type union
  - Add `iou_score` to evaluator type union
  - Add `coordinate_distance` to evaluator type union
  - Document configuration options for each type

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

- [ ] **Task 2.4**: Implement aggregation strategies for `FieldAccuracyEvaluator`
  - Implement weighted_average aggregation
  - Implement all_or_nothing aggregation
  - Generate hits/misses arrays
  - Calculate precision/recall/F1 when applicable
  - Add unit tests for aggregation

- [ ] **Task 2.5**: Implement `IoUScoreEvaluator` class
  - Implement IoU calculation for xyxy format
  - Implement IoU calculation for xywh format
  - Implement IoU calculation for polygon format
  - Add format conversion utilities
  - Add unit tests for IoU calculations

- [ ] **Task 2.6**: Implement `CoordinateDistanceEvaluator` class
  - Implement Euclidean distance metric
  - Implement Manhattan distance metric
  - Implement Cosine distance metric
  - Support 2D and 3D coordinates
  - Add unit tests for distance calculations

- [ ] **Task 2.7**: Add batch evaluation support for geometric evaluators
  - Implement array handling for multiple bboxes
  - Implement array handling for multiple coordinates
  - Calculate aggregate scores across batches
  - Add unit tests for batch evaluation

## Phase 3: Schema & Validation

- [ ] **Task 3.1**: Extend YAML schema types in `packages/core/src/evaluation/types.ts`
  - Add `FieldAccuracyEvaluatorConfig` type
  - Add `IoUScoreEvaluatorConfig` type
  - Add `CoordinateDistanceEvaluatorConfig` type
  - Update `EvaluatorConfig` union type
  - Update `EvaluatorKind` literals

- [ ] **Task 3.2**: Add Zod validation schemas in `packages/core/src/evaluation/validation/`
  - Create field_accuracy schema
  - Create iou_score schema
  - Create coordinate_distance schema
  - Add validation error messages
  - Add unit tests for schema validation

- [ ] **Task 3.3**: Update YAML parser in `packages/core/src/evaluation/yaml-parser.ts`
  - Register new evaluator types
  - Add configuration resolution logic
  - Handle relative path resolution for nested fields
  - Add integration tests for YAML parsing

## Phase 4: Integration & Testing

- [ ] **Task 4.1**: Create example eval files in `examples/features/structured-data/`
  - Create invoice extraction example with field_accuracy
  - Create document layout example with iou_score
  - Create coordinate extraction example with coordinate_distance
  - Include ground truth data and expected results

- [ ] **Task 4.2**: Add integration tests in `packages/core/test/integration/`
  - Test end-to-end invoice field extraction evaluation
  - Test end-to-end bounding box evaluation
  - Test error handling and edge cases
  - Test performance benchmarks (<10ms per field, <5ms per bbox)

- [ ] **Task 4.3**: Update orchestrator to register new evaluators
  - Add evaluator factory logic in `packages/core/src/evaluation/orchestrator.ts`
  - Ensure evaluators receive correct context
  - Verify evaluation results structure
  - Add integration tests for orchestrator

## Phase 5: Documentation

- [ ] **Task 5.1**: Update main README.md
  - Add structured data evaluators to feature list
  - Link to detailed documentation
  - Include quick start example

- [ ] **Task 5.2**: Create structured data evaluation guide in `docs/`
  - Document field_accuracy evaluator with examples
  - Document geometric evaluators with examples
  - Explain match types and when to use each
  - Include best practices for structuring eval cases

- [ ] **Task 5.3**: Update CLI help documentation
  - Ensure new evaluator types appear in help text
  - Add examples to CLI documentation
  - Update schema reference docs

- [ ] **Task 5.4**: Create migration guide for users with existing code_judge scripts
  - Show before/after examples
  - Explain benefits of built-in evaluators
  - Provide conversion templates

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
  - Benchmark IoU calculation (<5ms target)
  - Benchmark batch operations
  - Document results and optimize if needed

- [ ] **Task 6.4**: Manual functional testing
  - Test with real invoice PDFs (if available)
  - Test with real bounding box data
  - Verify error messages are helpful
  - Test with various input formats

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

- **Parallel Work**: Tasks 2.1-2.7 can be implemented in parallel after Task 1.4
- **Blocking**: Phase 3 requires Phase 2 completion
- **Blocking**: Phase 4 requires Phase 3 completion
- **Parallel Work**: Phase 5 can start alongside Phase 4

## Success Validation

Before marking this change complete, verify:

✅ All tests pass (`bun test`)  
✅ No type errors (`bun run typecheck`)  
✅ No lint violations (`bun run lint`)  
✅ Performance targets met (<10ms field, <5ms bbox)  
✅ Example eval files execute successfully  
✅ Documentation is complete and accurate  
✅ Changeset created with appropriate version bump
