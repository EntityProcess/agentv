# Rubric Evaluator Examples

This directory demonstrates AgentV's rubric-based evaluation feature.

## Overview

The rubric evaluator provides structured, deterministic evaluation by checking answers against a list of specific criteria (rubrics). Each rubric item can have:
- **Description**: What to check for
- **Weight**: Relative importance (default: 1.0)
- **Required**: Whether it's mandatory (default: true)

## Files in This Directory

- **`rubric-examples.yaml`**: Complete examples showing various rubric patterns

## Key Features

### 1. Inline Rubrics (Simple Format)

Use simple strings for quick rubric definition:

```yaml
- id: example-1
  expected_outcome: Explain quicksort algorithm
  
  rubrics:
    - Mentions divide-and-conquer approach
    - Explains the partition step
    - States time complexity correctly
```

### 2. Detailed Rubric Objects

Use objects for fine-grained control:

```yaml
rubrics:
  - id: structure
    description: Has clear headings and organization
    weight: 1.0
    required: true
  
  - id: examples
    description: Includes practical examples
    weight: 0.5
    required: false
```

### 3. Verdict Field

Rubric evaluations include a verdict based on score and required rubrics:
- **pass**: Score ≥ 0.8 and all required rubrics met
- **borderline**: Score ≥ 0.6 and all required rubrics met
- **fail**: Score < 0.6 or any required rubric failed

### 4. Generate Rubrics from Expected Outcome

You can automatically generate rubrics from the `expected_outcome` field:

```bash
# Generate rubrics for all eval cases without rubrics
agentv generate rubrics evals/rubric/rubric-examples.yaml

# Use a specific target for generation
agentv generate rubrics evals/rubric/rubric-examples.yaml --target openai:gpt-4o

# Verbose output
agentv generate rubrics evals/rubric/rubric-examples.yaml --verbose
```

This will update your YAML file in-place, adding generated rubrics to each eval case.

### 5. Expected Outcome Field

Use `expected_outcome` instead of `outcome` (backward compatible):

```yaml
- id: example
  expected_outcome: Provide a clear explanation with examples
  # outcome: ... (still works but expected_outcome is preferred)
```

## Running Evaluations

```bash
# Run with rubric evaluation
agentv evals/rubric/rubric-examples.yaml

# Run specific test case
agentv evals/rubric/rubric-examples.yaml --eval-id code-explanation-simple
```

## Rubric Scoring

The rubric evaluator calculates scores based on:
1. Each rubric item is checked (satisfied/not satisfied)
2. Weights are applied to satisfied items
3. Final score = (sum of satisfied weights) / (total weights)
4. Verdict determined by score and required rubrics

Example:
- 3 rubrics: weights [2.0, 1.0, 1.0], all required
- 2 satisfied (2.0 + 1.0 = 3.0)
- Score = 3.0 / 4.0 = 0.75
- Verdict = "borderline" (score ≥ 0.6, all required met)

## Combining Evaluators

Rubric evaluators can be combined with other evaluator types:

```yaml
rubrics:
  - Uses proper Python syntax
  - Includes error handling

execution:
  evaluators:
    # Rubric evaluator auto-added from inline rubrics
    
    # Additional evaluators
    - name: syntax_check
      type: code
      script: python -m py_compile
    
    - name: code_quality
      type: llm_judge
      prompt: evaluators/prompts/code-quality.md
```

## Tips

1. **Start Simple**: Use string rubrics for quick iterations
2. **Add Weights**: Use weights to emphasize important aspects
3. **Mark Required**: Use `required: true` for must-have criteria
4. **Generate First**: Use `agentv generate rubrics` to bootstrap your rubrics
5. **Iterate**: Refine generated rubrics based on evaluation results
