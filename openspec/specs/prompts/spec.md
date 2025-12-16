# prompts Specification

## Purpose
TBD - created by archiving change implement-rubric-evaluator. Update Purpose after archive.
## Requirements
### Requirement: Rubric Generation Prompt MUST be defined
The system SHALL use a specific default prompt to generate high-quality, testable rubrics from an `expected_outcome`.

#### Scenario: Default Generation Prompt
Given a task to generate rubrics
When the prompt is constructed
Then it should use the following default system prompt (or semantically similar):
"""
You are a strict rubric writer. Create a concise, testable checklist for the following task.
Avoid vague criteria; each item must be verifiable from an answer.
Assign weights (0-1) to each item based on its importance to the overall success of the task.
"""

### Requirement: Rubric Grading Prompt MUST be defined
The system SHALL use a specific prompt to grade answers against a provided rubric.

#### Scenario: Grading Prompt Content
Given a task to grade an answer
When the prompt is constructed
Then it should include instructions to:
  - Act as an "impartial grader".
  - Evaluate each rubric item individually.
  - Provide brief notes for each item.
  - Calculate a score based on met items and weights.
  - Determine a verdict (`pass`, `fail`, `borderline`) based on the score and required items.

