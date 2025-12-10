# Tasks: Add Custom Evaluator Template Validation

## Implementation Tasks

- [x] Add `validateCustomPromptContent()` function to check for required template variables
- [x] Add validation for invalid/unknown template variables (catches typos)
- [x] Update `resolveCustomPrompt()` to call validation for both file-based and inline prompts
- [x] Add ANSI color constants for warning output
- [x] Create warning message explaining required fields
- [x] Create warning message for invalid variables
- [x] Add unit test: warns when template is missing required fields
- [x] Add unit test: no warning when `{{ candidate_answer }}` is present
- [x] Add unit test: no warning when `{{ expected_messages }}` is present
- [x] Add unit test: warns when template contains invalid variables (typos, undefined vars)
- [x] Add unit test: validates inline prompts in addition to file-based prompts
- [x] Fix lint errors (ESLint no-explicit-any warnings)
- [x] Fix TypeScript compilation errors
- [x] Verify all tests pass
- [x] Update documentation to reflect validation behavior

## Validation

- [x] All unit tests pass (13 tests in orchestrator.test.ts)
- [x] Lint passes (`pnpm lint`)
- [x] TypeScript compilation passes (`pnpm typecheck`)
- [x] Warning appears for incomplete templates
- [x] Warning appears for invalid/unknown template variables
- [x] No warnings for valid templates with required fields
