# Spec: YAML Schema Updates

## MODIFIED Requirements

### Requirement: Expected Outcome Field
The YAML parser must support `expected_outcome` as the primary field for defining the goal, while maintaining support for `outcome` as an alias.

#### Scenario: Parse expected_outcome
Given a YAML file with `expected_outcome: "Goal"`
When parsed
Then the `EvalCase` object should have `expected_outcome` set to "Goal".

#### Scenario: Parse outcome alias
Given a YAML file with `outcome: "Goal"`
When parsed
Then the `EvalCase` object should have `expected_outcome` set to "Goal".

### Requirement: Inline Rubrics
The YAML parser must support a `rubrics` list on the `EvalCase` and automatically configure a `RubricEvaluator`.

#### Scenario: Inline Rubrics Definition
Given a YAML file with:
```yaml
rubrics:
  - "Must be polite"
```
When parsed
Then the `EvalCase` should have an evaluator of type `rubric` configured with the provided rubric item.

### Requirement: Explicit Rubric Evaluator Configuration
The YAML parser must support configuring the `RubricEvaluator` explicitly in the `evaluators` list, allowing for advanced options like model selection.

#### Scenario: Explicit Configuration
Given a YAML file with:
```yaml
evaluators:
  - type: rubric
    rubrics: ["Must be polite"]
    model: "gpt-4"
```
When parsed
Then the `EvalCase` should have a `RubricEvaluator` configured with the specified model and rubrics.

### Requirement: Verdict in Score
The `EvaluationScore` type must include an optional `verdict` field.

#### Scenario: Score Type
Given the `EvaluationScore` interface
When inspected
Then it should have a property `verdict?: 'pass' | 'fail' | 'borderline'`.
