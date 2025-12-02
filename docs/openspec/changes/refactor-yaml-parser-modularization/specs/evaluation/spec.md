## MODIFIED Requirements

### Requirement: YAML evaluation files

AgentV SHALL load evaluation definitions from YAML files using a documented schema and produce a list of `EvalCase` objects that can be executed by the evaluation engine.

#### Scenario: Backwards-compatible YAML parsing after refactor

- **GIVEN** an existing evaluation YAML file that previously loaded successfully via `loadEvalCases()`
- **WHEN** the YAML parser is refactored into modular components (file resolver, config loader, segment formatter, message processor, prompt builder, evaluator parser, and orchestrator)
- **THEN** the same YAML file MUST still load successfully without requiring changes to its content
- **AND** the set of generated `EvalCase` objects (including prompts, messages, evaluators, and configuration) MUST be equivalent to the pre-refactor behavior
- **AND** any validation or error messages for invalid YAML files MUST remain functionally consistent (aside from wording improvements where tests are updated accordingly)

#### Scenario: Improved testability of evaluation loading

- **GIVEN** the evaluation loader is split into cohesive modules
- **WHEN** a developer writes tests for file resolution, configuration loading, message processing, segment formatting, prompt building, or evaluator parsing
- **THEN** each concern MUST be testable in isolation without requiring end-to-end `loadEvalCases()` calls
- **AND** the project SHOULD maintain or improve code coverage for evaluation loading logic compared to the pre-refactor implementation.
