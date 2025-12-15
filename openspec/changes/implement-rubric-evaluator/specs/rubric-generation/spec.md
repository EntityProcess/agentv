# Spec: Rubric Generation CLI

## ADDED Requirements

### Requirement: Generate Rubrics Command
The CLI must provide a `generate rubrics` command to generate rubrics for eval cases that have an `expected_outcome` but are missing `rubrics`.

#### Scenario: Generate Missing Rubrics
Given a YAML file with an eval case containing `expected_outcome` but no `rubrics`
When `agentv generate rubrics <file>` is run
Then the tool should call the LLM to generate rubrics based on the outcome
And update the YAML file in-place with the generated `rubrics` list.

#### Scenario: Skip Existing Rubrics
Given a YAML file with an eval case that already has `rubrics`
When `agentv generate rubrics <file>` is run
Then the tool should preserve the existing rubrics
And not overwrite them.

### Requirement: YAML Preservation
The CLI must preserve existing comments and structure when updating the YAML file.

#### Scenario: Preserve Comments
Given a YAML file with comments (e.g., `# TODO: fix this`)
When `agentv generate rubrics` updates the file
Then the comments should remain in the file
And the structure (indentation, ordering) should be preserved as much as possible.

### Requirement: Deterministic Evaluation
The `RubricEvaluator` should primarily rely on the static `rubrics` present in the configuration.

#### Scenario: Evaluate with Static Rubrics
Given an eval case with `rubrics`
When the evaluator runs
Then it should use the provided rubrics for grading
And not perform any generation step.
