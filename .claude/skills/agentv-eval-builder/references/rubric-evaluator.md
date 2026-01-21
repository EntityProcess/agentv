# Rubric Evaluator Guide

Rubrics provide structured evaluation through lists of criteria that define what makes a good response. Rubrics are checked by an LLM judge and scored based on weights and requirements.

## Basic Usage

### Simple String Rubrics

Define rubrics as simple strings - each becomes a required criterion with weight 1.0:

```yaml
evalcases:
  - id: quicksort-explanation
    expected_outcome: Explain how quicksort works
    
    input_messages:
      - role: user
        content: Explain how the quicksort algorithm works
    
    rubrics:
      - Mentions divide-and-conquer approach
      - Explains the partition step
      - States time complexity correctly
```

### Detailed Rubric Objects (Checklist Mode)

Use objects for fine-grained control over weights and requirements:

```yaml
evalcases:
  - id: technical-guide
    expected_outcome: Write a comprehensive HTTP status codes guide

    input_messages:
      - role: user
        content: Write a guide explaining HTTP status codes

    rubrics:
      - id: structure
        expected_outcome: Has clear headings and organization
        weight: 1.0
        required: true

      - id: success-codes
        expected_outcome: Covers 2xx success codes with examples
        weight: 2.0
        required: true

      - id: client-errors
        expected_outcome: Explains 4xx client error codes
        weight: 2.0
        required: true

      - id: server-errors
        expected_outcome: Explains 5xx server error codes
        weight: 1.5
        required: false

      - id: practical-examples
        expected_outcome: Includes practical use case examples
        weight: 1.0
        required: false
```

### Score-Range Rubrics (Analytic Mode)

For more granular scoring, use `score_ranges` to define 0-10 integer scoring per criterion:

```yaml
evalcases:
  - id: code-review
    expected_outcome: Review the code for correctness and style

    input_messages:
      - role: user
        content: Review this Python function for issues

    rubrics:
      - id: correctness
        weight: 2.0
        required_min_score: 7  # Fail if score < 7
        score_ranges:
          - score_range: [0, 2]
            expected_outcome: Contains critical bugs or errors
          - score_range: [3, 5]
            expected_outcome: Has minor bugs or edge case issues
          - score_range: [6, 8]
            expected_outcome: Functionally correct with minor issues
          - score_range: [9, 10]
            expected_outcome: Fully correct implementation

      - id: style
        weight: 1.0
        score_ranges:
          - score_range: [0, 3]
            expected_outcome: Poor style, hard to read
          - score_range: [4, 6]
            expected_outcome: Acceptable style with issues
          - score_range: [7, 10]
            expected_outcome: Clean, idiomatic code
```

**Score-range validation rules:**
- Ranges must be integers within 0-10
- Ranges must not overlap
- Ranges must cover all values 0-10 (no gaps)
- Each range must have a non-empty `expected_outcome`

## Rubric Object Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | auto-generated | Unique identifier for the rubric |
| `expected_outcome` | string | required* | The criterion being evaluated (*optional if `score_ranges` used) |
| `weight` | number | 1.0 | Relative importance (higher = more impact on score) |
| `required` | boolean | true | If true, failing this rubric forces verdict to 'fail' (checklist mode) |
| `required_min_score` | integer | - | Minimum 0-10 score required to pass (score-range mode) |
| `score_ranges` | array | - | Score range definitions for analytic rubric scoring |

> **Note:** `description` is supported as a backward-compatible alias for `expected_outcome`.

## Scoring and Verdicts

### Checklist Mode (boolean)
```
score = (sum of satisfied weights) / (total weights)
```

### Score-Range Mode (0-10 integers)
```
normalized_score = raw_score / 10  # Convert 0-10 to 0-1
final_score = weighted_average(normalized_scores)
```

**Verdict Rules:**
- `pass`: Score ≥ 0.8 AND all gating criteria satisfied
- `borderline`: Score ≥ 0.6 AND all gating criteria satisfied
- `fail`: Score < 0.6 OR any gating criterion failed

**Gating:**
- Checklist mode: `required: true` means must be satisfied
- Score-range mode: `required_min_score: N` means score must be ≥ N

## When to Use Each Mode

| Use Case | Mode | Why |
|----------|------|-----|
| Binary pass/fail criteria | Checklist | Simple yes/no evaluation |
| Quality gradient | Score-range | Captures nuance (poor → excellent) |
| Critical requirements | Checklist + `required: true` | Hard gating on must-haves |
| Minimum quality bar | Score-range + `required_min_score` | Flexible threshold gating |

## Combining Rubrics with Other Evaluators

Rubrics can be combined with code evaluators for comprehensive validation:

```yaml
evalcases:
  - id: email-validator
    expected_outcome: Python function to validate email addresses
    
    input_messages:
      - role: user
        content: Write a Python function to validate email addresses
    
    # Semantic evaluation via rubrics
    rubrics:
      - Uses regular expressions for validation
      - Includes type hints
      - Has docstring documentation
      - Handles edge cases (None, empty string)
    
    execution:
      evaluators:
        # Rubric evaluator is auto-added from inline rubrics field
        
        # Additional code evaluator for syntax checking
        - name: python_syntax
          type: code_judge
          script: uv run python -m py_compile
```

## Generate Rubrics from Expected Outcome

Use the CLI to auto-generate rubrics from `expected_outcome`:

```bash
# Generate rubrics for eval cases that don't have them
agentv generate rubrics evals/my-eval.yaml

# Use a specific LLM target for generation
agentv generate rubrics evals/my-eval.yaml --target azure_base
```

This analyzes each `expected_outcome` and creates appropriate rubric items.

## Best Practices

1. **Use required sparingly** - Only mark rubrics as `required: true` for critical criteria
2. **Balance weights** - Use higher weights (2.0+) for core requirements, lower (0.5) for nice-to-haves
3. **Be specific** - "Includes error handling" is better than "Good code quality"
4. **Keep rubrics atomic** - Each rubric should test one thing
5. **Consider partial credit** - Non-required rubrics allow partial scores
