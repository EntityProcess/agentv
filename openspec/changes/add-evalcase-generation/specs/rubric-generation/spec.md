# Spec Delta: rubric-generation (generate evals)

## ADDED Requirements

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
