# Spec: JSONL Dataset Format

## Purpose
Support JSONL (JSON Lines) format for evaluation datasets as an alternative to YAML, following industry standards for ML/AI frameworks. Enables large-scale evaluation with streaming-friendly, Git-friendly, and tool-compatible dataset files.

## ADDED Requirements

### Requirement: JSONL File Format Detection

The system SHALL detect JSONL format by file extension and route to appropriate parser.

#### Scenario: Detect JSONL file by extension
- **GIVEN** a file path ending in `.jsonl`
- **WHEN** `loadEvalCases()` is called with that path
- **THEN** the system SHALL use the JSONL parser
- **AND** parse the file line-by-line as JSONL

#### Scenario: Detect YAML file by extension
- **GIVEN** a file path ending in `.yaml` or `.yml`
- **WHEN** `loadEvalCases()` is called with that path
- **THEN** the system SHALL use the existing YAML parser
- **AND** maintain backward compatibility

#### Scenario: Reject unsupported file extensions
- **GIVEN** a file path ending in `.json`, `.txt`, or other unsupported extension
- **WHEN** `loadEvalCases()` is called with that path
- **THEN** the system SHALL throw an error
- **AND** the error message SHALL list supported formats (`.yaml`, `.yml`, `.jsonl`)

### Requirement: JSONL Line Parsing

The system SHALL parse JSONL files line-by-line with strict JSON validation.

#### Scenario: Parse valid single-line JSONL
- **GIVEN** a JSONL file with one line containing valid JSON:
  ```jsonl
  {"id": "test-1", "expected_outcome": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}
  ```
- **WHEN** the file is parsed
- **THEN** the system SHALL return one eval case
- **AND** the eval case SHALL have `id: "test-1"`, `expectedOutcome: "Goal"`, and appropriate input messages

#### Scenario: Parse multi-line JSONL
- **GIVEN** a JSONL file with multiple lines:
  ```jsonl
  {"id": "test-1", "expected_outcome": "Goal 1", "input_messages": [...]}
  {"id": "test-2", "expected_outcome": "Goal 2", "input_messages": [...]}
  {"id": "test-3", "expected_outcome": "Goal 3", "input_messages": [...]}
  ```
- **WHEN** the file is parsed
- **THEN** the system SHALL return three eval cases
- **AND** each case SHALL have the correct id and expected_outcome

#### Scenario: Skip empty lines
- **GIVEN** a JSONL file with empty lines or whitespace-only lines:
  ```jsonl
  {"id": "test-1", "expected_outcome": "Goal 1", "input_messages": [...]}
  
  {"id": "test-2", "expected_outcome": "Goal 2", "input_messages": [...]}
     
  {"id": "test-3", "expected_outcome": "Goal 3", "input_messages": [...]}
  ```
- **WHEN** the file is parsed
- **THEN** the system SHALL skip empty/whitespace lines
- **AND** return three eval cases without errors

#### Scenario: Error on malformed JSON
- **GIVEN** a JSONL file with invalid JSON on line 5:
  ```jsonl
  {"id": "test-1", "expected_outcome": "Goal 1", "input_messages": [...]}
  {"id": "test-2", "expected_outcome": "Goal 2", "input_messages": [...]}
  {"id": "test-3", "expected_outcome": "Goal 3", "input_messages": [...]}
  {"id": "test-4", "expected_outcome": "Goal 4", "input_messages": [...]}
  {"id": "test-5", "expected_outcome": "Goal 5" "input_messages": [...]}
  ```
- **WHEN** the file is parsed
- **THEN** the system SHALL throw an error
- **AND** the error message SHALL include "Line 5: Invalid JSON"
- **AND** the error message SHALL include the JSON parse error details

#### Scenario: Error on missing required fields
- **GIVEN** a JSONL file where line 3 is missing `expected_outcome`:
  ```jsonl
  {"id": "test-1", "expected_outcome": "Goal 1", "input_messages": [...]}
  {"id": "test-2", "expected_outcome": "Goal 2", "input_messages": [...]}
  {"id": "test-3", "input_messages": [...]}
  ```
- **WHEN** the file is parsed
- **THEN** the system SHALL skip the invalid case and log a warning
- **AND** the warning SHALL include "Line 3" and "missing expected_outcome"
- **AND** continue parsing remaining cases (same behavior as YAML)

### Requirement: Sidecar Metadata File

The system SHALL support optional sidecar YAML file for dataset-level metadata.

#### Scenario: Load metadata from sidecar YAML
- **GIVEN** a JSONL file `dataset.jsonl`
- **AND** a companion file `dataset.yaml` with content:
  ```yaml
  description: Test dataset
  dataset: my-tests
  execution:
    target: azure_base
  evaluator: llm_judge
  ```
- **WHEN** `loadEvalCases('dataset.jsonl')` is called
- **THEN** the system SHALL load metadata from `dataset.yaml`
- **AND** apply `execution.target: "azure_base"` as default for all cases
- **AND** apply `evaluator: "llm_judge"` as default evaluator

#### Scenario: Use defaults when sidecar not found
- **GIVEN** a JSONL file `dataset.jsonl` with no companion YAML
- **WHEN** `loadEvalCases('dataset.jsonl')` is called
- **THEN** the system SHALL use default values:
  - `dataset`: basename of JSONL file ("dataset")
  - `execution.target`: "default"
  - `evaluator`: "llm_judge"
  - `description`: empty string
- **AND** SHALL NOT throw an error

#### Scenario: Look for companion YAML with same base name
- **GIVEN** a JSONL file at path `evals/subfolder/mytest.jsonl`
- **WHEN** loading eval cases
- **THEN** the system SHALL check for `evals/subfolder/mytest.yaml`
- **AND** SHALL NOT check for `dataset.yaml` or other names

### Requirement: Per-Case Field Overrides

The system SHALL support per-case overrides for execution, evaluators, and rubrics in JSONL lines.

#### Scenario: Override execution target per case
- **GIVEN** a sidecar YAML with `execution.target: "azure_base"`
- **AND** a JSONL line:
  ```jsonl
  {"id": "openai-test", "expected_outcome": "Uses OpenAI", "input_messages": [...], "execution": {"target": "openai_gpt4"}}
  ```
- **WHEN** the eval case is loaded
- **THEN** the case SHALL use `target: "openai_gpt4"`
- **AND** the sidecar default SHALL be overridden for this case only

#### Scenario: Override evaluators per case
- **GIVEN** a sidecar YAML with `evaluator: llm_judge`
- **AND** a JSONL line:
  ```jsonl
  {"id": "rubric-test", "expected_outcome": "Uses rubric", "input_messages": [...], "evaluators": [{"type": "rubric", "rubrics": ["Must be polite"]}]}
  ```
- **WHEN** the eval case is loaded
- **THEN** the case SHALL use the rubric evaluator
- **AND** the sidecar default evaluator SHALL be overridden for this case only

#### Scenario: Merge defaults with per-case fields
- **GIVEN** a sidecar YAML with:
  ```yaml
  execution:
    target: azure_base
  evaluator: llm_judge
  ```
- **AND** a JSONL line with only `execution` override:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input_messages": [...], "execution": {"target": "openai"}}
  ```
- **WHEN** the eval case is loaded
- **THEN** the case SHALL use `target: "openai"` (overridden)
- **AND** the case SHALL use `evaluator: "llm_judge"` (from sidecar)

### Requirement: File Reference Resolution

The system SHALL resolve file references in JSONL content relative to the JSONL file location.

#### Scenario: Resolve relative file reference
- **GIVEN** a JSONL file at `evals/tests/dataset.jsonl`
- **AND** a line with file reference:
  ```jsonl
  {"id": "test", "expected_outcome": "Reviews code", "input_messages": [{"role": "user", "content": [{"type": "file", "value": "./code.py"}]}]}
  ```
- **WHEN** the eval case is loaded
- **THEN** the system SHALL resolve `./code.py` relative to `evals/tests/`
- **AND** load content from `evals/tests/code.py`

#### Scenario: Resolve guideline files from JSONL
- **GIVEN** a JSONL file at `evals/dataset.jsonl`
- **AND** a config with `guideline_patterns: ["*.instructions.md"]`
- **AND** a line with guideline reference:
  ```jsonl
  {"id": "test", "expected_outcome": "Follows guidelines", "input_messages": [{"role": "user", "content": [{"type": "file", "value": "python.instructions.md"}]}]}
  ```
- **WHEN** the eval case is loaded
- **THEN** the system SHALL detect the guideline file
- **AND** process it as a guideline (prepend to prompt, wrap in guidelines block)

### Requirement: Schema Compatibility

The system SHALL produce identical `EvalCase` objects from JSONL and YAML formats.

#### Scenario: JSONL and YAML produce same EvalCase
- **GIVEN** a YAML file with:
  ```yaml
  evalcases:
    - id: test-1
      expected_outcome: Goal
      input_messages:
        - role: user
          content: Query
  ```
- **AND** a JSONL file with:
  ```jsonl
  {"id": "test-1", "expected_outcome": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}
  ```
- **WHEN** both files are parsed
- **THEN** both SHALL produce identical `EvalCase` objects
- **AND** downstream code SHALL work identically with both

#### Scenario: All eval case fields supported in JSONL
- **GIVEN** a JSONL line with all supported fields:
  ```jsonl
  {
    "id": "full-test",
    "conversation_id": "conv-1",
    "expected_outcome": "Goal",
    "input_messages": [...],
    "expected_messages": [...],
    "execution": {"target": "azure"},
    "evaluators": [...],
    "rubrics": [...]
  }
  ```
- **WHEN** the line is parsed
- **THEN** all fields SHALL be preserved in the `EvalCase` object
- **AND** the case SHALL validate and execute correctly

### Requirement: Error Reporting

The system SHALL provide clear, actionable error messages for JSONL parsing failures.

#### Scenario: Line number in parse errors
- **GIVEN** a JSONL file with JSON syntax error on line 42
- **WHEN** the file is parsed
- **THEN** the error message SHALL include "Line 42"
- **AND** SHALL include the specific JSON parse error

#### Scenario: Field validation errors reference line
- **GIVEN** a JSONL file where line 10 has invalid field type (string instead of array for `input_messages`)
- **WHEN** the file is parsed
- **THEN** the error/warning message SHALL include "Line 10"
- **AND** SHALL indicate the field name and expected type

#### Scenario: Sidecar not found is a warning, not error
- **GIVEN** a JSONL file without companion YAML
- **WHEN** the file is loaded with verbose logging enabled
- **THEN** the system SHALL log a warning about missing sidecar
- **AND** SHALL continue with defaults
- **AND** SHALL NOT throw an error

### Requirement: Backward Compatibility

The system SHALL maintain full backward compatibility with existing YAML-only workflows.

#### Scenario: Existing YAML files work unchanged
- **GIVEN** an existing YAML eval file
- **WHEN** `loadEvalCases()` is called with the YAML file path
- **THEN** the system SHALL parse it with the YAML parser
- **AND** produce identical results as before JSONL support was added

#### Scenario: Mixed YAML and JSONL in same repo
- **GIVEN** a repository with both:
  - `evals/test1.yaml`
  - `evals/test2.jsonl`
- **WHEN** running evals from both files
- **THEN** both SHALL work correctly
- **AND** YAML files SHALL use YAML parser
- **AND** JSONL files SHALL use JSONL parser

#### Scenario: CLI works with both formats
- **GIVEN** the CLI command `agentv run evals/test.jsonl`
- **WHEN** executed
- **THEN** the CLI SHALL detect JSONL format and run the eval
- **AND** produce same output format as YAML evals
