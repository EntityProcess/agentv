# rubric-generation Specification

## Purpose
TBD - created by archiving change implement-rubric-evaluator. Update Purpose after archive.
## Requirements
### Requirement: Generate Rubrics Command MUST be provided
The CLI SHALL provide a `generate rubrics` command to generate rubrics for eval cases that have an `expected_outcome` but are missing `rubrics`.

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

### Requirement: YAML Preservation MUST be maintained
The CLI SHALL preserve existing comments and structure when updating the YAML file.

#### Scenario: Preserve Comments
Given a YAML file with comments (e.g., `# TODO: fix this`)
When `agentv generate rubrics` updates the file
Then the comments should remain in the file
And the structure (indentation, ordering) should be preserved as much as possible.

### Requirement: Deterministic Evaluation MUST use static rubrics
The `RubricEvaluator` SHALL primarily rely on the static `rubrics` present in the configuration.

#### Scenario: Evaluate with Static Rubrics
Given an eval case with `rubrics`
When the evaluator runs
Then it should use the provided rubrics for grading
And not perform any generation step.

### Requirement: Generate Evals Command MUST be provided
The CLI SHALL provide a `generate evals` command to create YAML eval suites from dataset files.

#### Scenario: Generate evalcases from JSON dataset
Given a dataset file `data.json` containing an array of objects
When `agentv generate evals --in data.json --out evals.yaml` is run
Then the tool should generate a YAML suite containing `evalcases`
And each eval case must include at least `id` and `input_messages`.

#### Scenario: Generate evalcases from JSONL dataset
Given a dataset file `data.jsonl` containing one JSON object per line
When `agentv generate evals --in data.jsonl --out evals.yaml` is run
Then the tool should generate a YAML suite containing one eval case per input line.

#### Scenario: Target selection for generation
When `agentv generate evals` runs without an explicit `--target`
Then it should resolve a generation target using the same discovery rules as `agentv eval` (targets file + default target)
And use that target for LLM calls.

#### Scenario: Prompt override
When the user supplies `--prompt-path custom.prompt.md`
Then the command should use that prompt content for generation instead of the default template.

#### Scenario: Concurrency control
When the user supplies `--concurrency 10`
Then the command should process up to 10 rows in parallel
And still produce a valid YAML output.

