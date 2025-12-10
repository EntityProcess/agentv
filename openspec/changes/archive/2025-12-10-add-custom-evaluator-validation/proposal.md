# Proposal: Add Custom Evaluator Template Validation

## Summary

Add validation warnings when custom LLM judge evaluator templates are missing required template variables, helping users create effective evaluator prompts that have something to evaluate against.

## Problem

Custom evaluator templates can be created without including the essential fields needed to perform evaluation. When a template contains only variables like `{{ question }}` without `{{ candidate_answer }}` or `{{ expected_messages }}`, the LLM judge receives no content to actually evaluate, resulting in meaningless or inconsistent evaluations.

## Solution

Add validation logic in `resolveCustomPrompt()` that checks custom evaluator templates (both file-based and inline) for the presence of at least one required evaluation field:
- `{{ candidate_answer }}` - to evaluate the agent's response
- `{{ expected_messages }}` - to compare against expected output

When neither field is present, display a clear warning message explaining what's missing and why it's needed.

## Impact

### User Impact
- **Improved UX**: Users get immediate feedback when their evaluator templates are incomplete
- **Better Documentation**: Clear guidance on what fields are required
- **Prevents Silent Failures**: Catches incomplete templates before they produce poor evaluations

### System Impact
- **Minimal**: Validation runs during template loading, adds negligible overhead
- **Non-breaking**: Warning only, doesn't block evaluation execution

## Scope

### In Scope
- Validation function to check for required template variables
- Warning messages for file-based and inline prompts
- Unit tests covering validation scenarios
- Documentation updates in custom-evaluators.md

### Out of Scope
- Validation of other template variables
- Enforcement of evaluation criteria or scoring rubrics
- Validation of code-based evaluators

## Implementation Notes

- Validation occurs in `packages/core/src/evaluation/orchestrator.ts`
- Uses regex pattern matching to detect template variables
- Warnings use ANSI color codes (yellow) for visibility
- Permissive approach: warns but allows evaluation to continue
