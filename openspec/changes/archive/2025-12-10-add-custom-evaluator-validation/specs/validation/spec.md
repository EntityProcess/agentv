# Validation Capability Delta

## Why

Custom LLM judge evaluator templates can be created without the essential fields needed to perform evaluation. When a template contains only `{{ question }}` without `{{ candidate_answer }}` or `{{ expected_messages }}`, the LLM judge has no content to evaluate against, resulting in meaningless evaluations.

This validation provides immediate feedback to help users create effective evaluator templates.

## ADDED Requirements

### Requirement: Custom Evaluator Template Validation

The system SHALL validate custom LLM judge evaluator templates to ensure they contain fields necessary for evaluation.

#### Scenario: Template missing both required fields shows warning

**Given** a custom evaluator template with content `"{{ question }}"`
**When** the template is loaded
**Then** a warning is displayed containing:
- Message: "Custom evaluator template at [source] is missing required fields"
- List of required fields: `{{ candidate_answer }}` and `{{ expected_messages }}`
- Explanation: "Without these, there is nothing to evaluate against"

#### Scenario: Template with candidate_answer does not warn

**Given** a custom evaluator template containing `"{{ candidate_answer }}"`
**When** the template is loaded
**Then** no validation warning is displayed

#### Scenario: Template with expected_messages does not warn

**Given** a custom evaluator template containing `"{{ expected_messages }}"`
**When** the template is loaded
**Then** no validation warning is displayed

#### Scenario: Validation applies to file-based prompts

**Given** an evaluator configured with `promptPath: "./my-eval.md"`
**And** the file contains only `"{{ question }}"`
**When** the custom prompt is resolved
**Then** a warning is displayed referencing the file path

#### Scenario: Invalid template variables are detected

**Given** a custom evaluator template containing `"{{ candiate_answer }} for {{ invalid_var }}"`
**When** validation runs
**Then** a warning is displayed listing the invalid variables
**And** the warning lists all valid template variables

#### Scenario: Validation is permissive

**Given** a custom evaluator template missing required fields
**When** validation runs
**Then** a warning is displayed
**But** evaluation continues without blocking

## Implementation Notes

- Validation occurs in `validateCustomPromptContent()` function
- Uses regex patterns to detect template variables: `/\{\{\s*(candidate_answer|expected_messages)\s*\}\}/`
- Validates all template variables against a whitelist of valid names
- Valid variables: `candidate_answer`, `expected_messages`, `question`, `expected_outcome`, `reference_answer`, `input_messages`, `output_messages` (legacy)
- Warnings use ANSI yellow color codes for visibility
- File-based (`promptPath`) evaluators are validated
