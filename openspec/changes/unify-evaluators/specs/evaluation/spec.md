# Spec: Evaluation Capability

## MODIFIED Requirements

### Requirement: LLM Judge Evaluator JSON Contract

The system SHALL instruct LLM judge evaluators to emit a single JSON object and normalize the response.

#### Scenario: Enforce JSON prompt contract

- **WHEN** an LLM judge evaluator (PromptEvaluator) builds its prompts in freeform mode
- **THEN** it renders a user prompt that includes `expected_outcome`, `question`, `reference_answer`, and `candidate_answer`
- **AND** it adds a system prompt that mandates a single JSON object with `score`, `hits`, `misses`, and `reasoning` (hits/misses capped at four items)

#### Scenario: Parse JSON evaluator response

- **WHEN** a judge provider returns a response
- **THEN** the evaluator extracts the first valid JSON object (directly or from surrounding text)
- **AND** clamps `score` to `[0, 1]` and trims `hits`/`misses` to non-empty strings with a maximum of four entries each
- **AND** falls back to `score: 0`, empty hits/misses, and optional `reasoning` when no valid JSON is present

#### Scenario: Record evaluator request metadata

- **WHEN** an LLM judge evaluation completes
- **THEN** the evaluator stores the rendered `userPrompt` and `systemPrompt` in `evaluator_provider_request`
- **AND** no warning is emitted on parse failure; the failure is reflected in the zeroed score

### ADDED Requirements

### Requirement: Unified Prompt Evaluator

The system SHALL support a unified `PromptEvaluator` that handles both freeform and rubric-based evaluation.

#### Scenario: Rubric Mode Trigger
- **Given** a `PromptEvaluator` configured with a non-empty `rubrics` list
- **When** `evaluate` is called
- **Then** it SHALL use the rubric-based evaluation logic (checking each rubric item).

#### Scenario: Freeform Mode Trigger
- **Given** a `PromptEvaluator` configured without `rubrics`
- **When** `evaluate` is called
- **Then** it SHALL use the freeform evaluation logic (generating score/hits/misses via LLM).

#### Scenario: Verdict Calculation (Freeform)
- **Given** a freeform evaluation result with a score
- **When** the verdict is calculated
- **Then** it SHALL be `pass` if score >= 0.8, `borderline` if >= 0.6, and `fail` otherwise.

#### Scenario: Verdict Calculation (Rubric)
- **Given** a rubric evaluation result
- **When** the verdict is calculated
- **Then** it SHALL be `fail` if any required rubric is not met, otherwise based on score thresholds (>= 0.8 pass, >= 0.6 borderline).

#### Scenario: Hits and Misses (Rubric)
- **Given** a rubric evaluation result
- **When** hits and misses are populated
- **Then** `hits` SHALL contain satisfied rubric items and `misses` SHALL contain unsatisfied rubric items.
