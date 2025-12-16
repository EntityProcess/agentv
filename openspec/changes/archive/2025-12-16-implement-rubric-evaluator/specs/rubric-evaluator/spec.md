# Spec: Rubric Evaluator

## ADDED Requirements

### Requirement: Static Rubric Evaluation MUST be supported
The evaluator SHALL accept a list of pre-defined rubrics and use them for grading.

#### Scenario: Explicit Rubrics
Given an eval case with `rubrics` defined in YAML
When the `RubricEvaluator` runs
Then it should use the provided rubrics to grade the answer.

#### Scenario: Missing Rubrics Error
Given an eval case with no `rubrics`
When the `RubricEvaluator` runs
Then it should fail with an error message instructing the user to run `agentv generate-rubrics`.

### Requirement: Structured Grading MUST produce validated results
The evaluator SHALL produce a structured evaluation result containing a score and a verdict, validated against a Zod schema.

#### Scenario: Grading Output Schema
Given a candidate answer and a rubric
When the evaluator grades the answer
Then it should return a JSON object matching the following schema:
```typescript
z.object({
  overallScore: z.number().min(0).max(1),
  verdict: z.enum(["pass", "borderline", "fail"]),
  details: z.array(z.object({
    id: z.string(),
    met: z.boolean(),
    notes: z.string().optional(),
    score: z.number().min(0).max(1),
  })),
})
```

### Requirement: Verdict Logic MUST be applied
The evaluator SHALL calculate the verdict based on the score and required items.

#### Scenario: Pass Verdict
Given a grading result where all required items are met and score >= 0.8
Then the verdict should be `pass`.

#### Scenario: Fail Verdict
Given a grading result where score < 0.6
Then the verdict should be `fail`.

#### Scenario: Borderline Verdict
Given a grading result where score is between 0.6 and 0.8
Then the verdict should be `borderline`.
