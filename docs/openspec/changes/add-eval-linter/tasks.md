# Implementation Tasks

## 1. Core Validation Infrastructure

- [ ] 1.1 Create `packages/core/src/evaluation/validation/` directory
- [ ] 1.2 Create `packages/core/src/evaluation/validation/types.ts` for validation result types
- [ ] 1.3 Create `packages/core/src/evaluation/validation/file-type.ts` for file type detection
- [ ] 1.4 Create `packages/core/src/evaluation/validation/eval-validator.ts` for eval file validation
- [ ] 1.5 Create `packages/core/src/evaluation/validation/targets-validator.ts` for targets file validation
- [ ] 1.6 Create `packages/core/src/evaluation/validation/file-reference-validator.ts` for file URL validation
- [ ] 1.7 Export validation functions from `packages/core/src/evaluation/validation/index.ts`

## 2. File Type Detection

- [ ] 2.1 Implement `$schema` field detection for `agentevo-eval-v2`
- [ ] 2.2 Implement `$schema` field detection for `agentevo-targets-v2`
- [ ] 2.3 Implement error for missing `$schema` field
- [ ] 2.4 Add error handling for unknown schema values
- [ ] 2.5 Write unit tests for file type detection (test/evaluation/validation/file-type.test.ts)

## 3. Eval File Validator

- [ ] 3.1 Implement `$schema` field validation (require `agentevo-eval-v2`)
- [ ] 3.2 Implement evalcases array validation
- [ ] 3.3 Implement eval case structure validation (id, outcome, input_messages, expected_messages)
- [ ] 3.4 Implement message role validation
- [ ] 3.5 Implement content format validation
- [ ] 3.6 Collect and aggregate all errors in single pass
- [ ] 3.7 Write unit tests for eval validator (test/evaluation/validation/eval-validator.test.ts)

## 4. Targets File Validator

- [ ] 4.1 Reuse existing validation from `targets-file.ts` where possible
- [ ] 4.2 Implement `$schema` field validation (require `agentevo-targets-v2`)
- [ ] 4.3 Implement targets array validation
- [ ] 4.4 Implement target definition validation (name, provider required)
- [ ] 4.5 Add warning for unknown providers (non-fatal)
- [ ] 4.6 Write unit tests for targets validator (test/evaluation/validation/targets-validator.test.ts)

## 5. File Reference Validation

- [ ] 5.1 Implement file existence checking for `type: file` content blocks
- [ ] 5.2 Implement relative path resolution from eval file directory
- [ ] 5.3 Handle both string content and array content formats
- [ ] 5.4 Provide clear error messages with resolved paths
- [ ] 5.5 Write unit tests with fixture files (test/evaluation/validation/file-reference-validator.test.ts)

## 6. Error Reporting

- [ ] 6.1 Create error result type with file path, location, message
- [ ] 6.2 Implement error aggregation across multiple files
- [ ] 6.3 Implement summary statistics (files checked, passed, failed)
- [ ] 6.4 Colorize output (red errors, yellow warnings, green success) for TTY
- [ ] 6.5 Plain text output when stdout is not a TTY
- [ ] 6.6 Implement JSON output mode via `--json` flag
- [ ] 6.7 Write tests for output formatting

## 7. CLI Command Implementation

- [ ] 7.1 Create `apps/cli/src/commands/lint/` directory
- [ ] 7.2 Create `apps/cli/src/commands/lint/index.ts` command handler
- [ ] 7.3 Implement path argument parsing (single file, multiple files, directories)
- [ ] 7.4 Implement directory traversal for all YAML files (*.yaml, *.yml)
- [ ] 7.5 Implement `--strict` flag
- [ ] 7.6 Implement `--json` flag for JSON output
- [ ] 7.7 Register lint command in `apps/cli/src/index.ts`
- [ ] 7.8 Set appropriate exit codes (0 for success, 1 for failures)

## 8. Strict Mode Features

- [ ] 8.1 Implement referenced instruction file non-empty check
- [ ] 8.2 Add strict mode flag to validator functions
- [ ] 8.3 Write tests for strict mode validation

## 9. Performance Optimization

- [ ] 9.1 Implement parallel file validation using worker threads or Promise.all
- [ ] 9.2 Limit parallelism to CPU core count
- [ ] 9.3 Implement early exit on YAML parse errors
- [ ] 9.4 Write performance tests for large file sets

## 10. Documentation and Examples

- [ ] 10.1 Update README.md with `lint` command usage
- [ ] 10.2 Add examples of common linting scenarios
- [ ] 10.3 Document exit codes and their meanings
- [ ] 10.4 Document strict mode checks
- [ ] 10.5 Add example CI workflow using `agentevo lint`

## 11. Integration Testing

- [ ] 11.1 Create test fixtures with valid and invalid eval files
- [ ] 11.2 Create test fixtures with valid and invalid targets files
- [ ] 11.3 Test end-to-end linting flow via CLI
- [ ] 11.4 Test directory linting with mixed file types
- [ ] 11.5 Test exit codes in success and failure scenarios
- [ ] 11.6 Test JSON output mode

## 12. Migration Support

- [ ] 12.1 Add `$schema: agentevo-eval-v2` to existing eval files
- [ ] 12.2 Add `$schema: agentevo-targets-v2` to targets.yaml files
- [ ] 12.3 Update documentation to show `$schema` field in examples
- [ ] 12.4 Create migration script to auto-add `$schema` to existing files
- [ ] 12.5 Document that files without `$schema` will fail linting

## Validation Criteria

Each task is complete when:
- Code is implemented and follows TypeScript 5.x/ES2022 guidelines
- Unit tests are written and passing
- Integration tests cover the feature
- Documentation is updated
- Code is reviewed and approved
