# Evaluation Capability Delta

## Why

The template variable name `output_messages` is inconsistent with the eval file schema field `expected_messages` and creates confusion. Renaming to `expected_messages` provides consistency across the system and clearer semantics (these are the expected messages, not just output).

## MODIFIED Requirements

### Requirement: LLM Judge Template Variables

The system SHALL provide template variables for LLM judge custom evaluator prompts to reference evaluation context.

**Change**: Renamed `{{ output_messages }}` variable to `{{ expected_messages }}` for consistency with eval schema.

#### Scenario: expected_messages variable available

**Given** a custom LLM judge evaluator template
**When** template substitution occurs
**Then** the `{{ expected_messages }}` variable contains JSON stringified output segments

**Note**: Previously named `{{ output_messages }}` - renamed for consistency with eval schema

#### Scenario: Template variable substitution

**Given** an eval case with `output_segments` data
**And** a custom evaluator template containing `{{ expected_messages }}`
**When** the template is rendered
**Then** `{{ expected_messages }}` is replaced with `JSON.stringify(output_segments, null, 2)`

#### Scenario: Backward compatibility not supported

**Given** a custom evaluator template containing `{{ output_messages }}`
**When** template substitution occurs  
**Then** the variable is NOT substituted (remains as literal text)
**And** validation may warn about missing required fields

## Implementation Notes

- Update variable name in `evaluators.ts` template substitution logic
- Update documentation to reflect new variable name
- This is a breaking change - existing templates must update to use `{{ expected_messages }}`
- Validation already checks for `{{ expected_messages }}` (no changes needed)
