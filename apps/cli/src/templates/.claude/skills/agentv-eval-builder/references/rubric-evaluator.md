# Rubric Evaluator Guide

Rubrics provide structured evaluation through lists of criteria that define what makes a good response. Rubrics are checked by an LLM judge and scored based on weights and requirements.

## Basic Usage

### Simple String Rubrics

Define rubrics as simple strings - each becomes a required criterion with weight 1.0:

```yaml
$schema: agentv-eval-v2

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

### Detailed Rubric Objects

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
        description: Has clear headings and organization
        weight: 1.0
        required: true
        
      - id: success-codes
        description: Covers 2xx success codes with examples
        weight: 2.0
        required: true
        
      - id: client-errors
        description: Explains 4xx client error codes
        weight: 2.0
        required: true
        
      - id: server-errors
        description: Explains 5xx server error codes
        weight: 1.5
        required: false
        
      - id: practical-examples
        description: Includes practical use case examples
        weight: 1.0
        required: false
```

## Rubric Object Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | auto-generated | Unique identifier for the rubric |
| `description` | string | required | The criterion being evaluated |
| `weight` | number | 1.0 | Relative importance (higher = more impact on score) |
| `required` | boolean | true | If true, failing this rubric forces verdict to 'fail' |

## Scoring and Verdicts

**Score Calculation:**
```
score = (sum of satisfied weights) / (total weights)
```

**Verdict Rules:**
- `pass`: Score ≥ 0.8 AND all required rubrics satisfied
- `borderline`: Score ≥ 0.6 AND all required rubrics satisfied  
- `fail`: Score < 0.6 OR any required rubric failed

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
