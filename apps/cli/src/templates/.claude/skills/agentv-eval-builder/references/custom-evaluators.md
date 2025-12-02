# Custom Evaluators Guide

Guide for writing custom code evaluators and LLM judges for AgentV eval files.

## Code Evaluator Contract

Code evaluators receive input via stdin and write output to stdout, both as JSON.

### Input Format (via stdin)

```json
{
  "task": "string describing the task",
  "outcome": "expected outcome description",
  "expected": "expected output string",
  "output": "generated code/text from the agent",
  "system_message": "system message if any",
  "guideline_paths": ["path1", "path2"],
  "attachments": ["file1", "file2"],
  "user_segments": [{"type": "text", "value": "..."}]
}
```

### Output Format (to stdout)

```json
{
  "score": 0.85,
  "hits": ["successful check 1", "successful check 2"],
  "misses": ["failed check 1"],
  "reasoning": "Brief explanation of the score"
}
```

**Field Requirements:**
- `score`: Float between 0.0 and 1.0 (required)
- `hits`: Array of strings describing what passed (optional but recommended)
- `misses`: Array of strings describing what failed (optional but recommended)
- `reasoning`: String explaining the score (optional but recommended)

## Python Code Evaluator Template

```python
#!/usr/bin/env python3
"""
Example code evaluator for AgentV

This evaluator checks for specific keywords in the output.
Replace validation logic as needed.
"""

import json
import sys
from typing import Any


def evaluate(input_data: dict[str, Any]) -> dict[str, Any]:
    """
    Evaluate the agent output.
    
    Args:
        input_data: Full input context from AgentV
    
    Returns:
        Evaluation result with score, hits, misses, reasoning
    """
    # Extract only the fields you need
    # Most evaluators only need 'output' - avoid using unnecessary fields
    output = input_data.get("output", "")
    
    # Your validation logic here
    hits = []
    misses = []
    
    # Example: Check for keywords
    required_keywords = ["async", "await"]
    for keyword in required_keywords:
        if keyword in output:
            hits.append(f"Contains required keyword: {keyword}")
        else:
            misses.append(f"Missing required keyword: {keyword}")
    
    # Calculate score
    if not required_keywords:
        score = 1.0
    else:
        score = len(hits) / len(required_keywords)
    
    # Build result
    return {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": f"Found {len(hits)}/{len(required_keywords)} required keywords"
    }


def main():
    """Main entry point for AgentV code evaluator."""
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        # Run evaluation
        result = evaluate(input_data)
        
        # Write result to stdout
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        # Error handling: return zero score with error message
        error_result = {
            "score": 0.0,
            "hits": [],
            "misses": [f"Evaluator error: {str(e)}"],
            "reasoning": f"Evaluator error: {str(e)}"
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

## JSON Format Validator Example

A common pattern is validating JSON output structure:

```python
#!/usr/bin/env python3
"""
JSON Format Validator for AgentV
Validates that output is valid JSON with required keys.
"""

import json
import sys
from typing import Any


def validate_json_format(output: str, required_keys: list[str]) -> dict[str, Any]:
    """
    Validate that output is valid JSON with required keys.
    
    Args:
        output: The candidate output to validate
        required_keys: List of required top-level keys
    
    Returns:
        Evaluation result dict
    """
    # Try to parse as JSON
    try:
        parsed = json.loads(output.strip())
    except json.JSONDecodeError as e:
        return {
            "score": 0.0,
            "hits": [],
            "misses": ["Not valid JSON"],
            "reasoning": f"Output is not valid JSON. Parse error: {str(e)}"
        }
    
    # Check if it's a dict
    if not isinstance(parsed, dict):
        return {
            "score": 0.0,
            "hits": [],
            "misses": ["JSON is not an object/dict"],
            "reasoning": f"Output is valid JSON but not an object. Got: {type(parsed).__name__}"
        }
    
    # Check for required keys
    missing_keys = [key for key in required_keys if key not in parsed]
    present_keys = [key for key in required_keys if key in parsed]
    
    if missing_keys:
        return {
            "score": 0.0,
            "hits": [f"Has key: {key}" for key in present_keys],
            "misses": [f"Missing key: {key}" for key in missing_keys],
            "reasoning": f"Valid JSON but missing required keys: {', '.join(missing_keys)}"
        }
    
    # All checks passed
    return {
        "score": 1.0,
        "hits": [f"Valid JSON with all required keys: {', '.join(required_keys)}"],
        "misses": [],
        "reasoning": f"Valid JSON with all required keys: {', '.join(required_keys)}"
    }


def main():
    """Main entry point."""
    try:
        input_data = json.loads(sys.stdin.read())
        output = input_data.get("output", "")
        
        # Define required keys (customize as needed)
        required_keys = ["criticalityRating", "reasoning"]
        
        result = validate_json_format(output, required_keys)
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        error_result = {
            "score": 0.0,
            "hits": [],
            "misses": [f"Evaluator error: {str(e)}"],
            "reasoning": f"Evaluator error: {str(e)}"
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

## LLM Judge Prompt Template

LLM judges use markdown prompts to guide evaluation:

```markdown
# Code Quality Judge

Evaluate the candidate code for quality, correctness, and best practices.

## Evaluation Criteria

Rate the code on:
1. **Correctness** - Does it solve the problem?
2. **Style** - Does it follow best practices?
3. **Completeness** - Are edge cases handled?
4. **Documentation** - Are there helpful comments/docstrings?

## Scoring Guidelines

- **0.9-1.0:** Excellent - Correct, clean, well-documented
- **0.7-0.8:** Good - Correct with minor style issues
- **0.5-0.6:** Adequate - Works but has quality issues
- **0.3-0.4:** Poor - Has bugs or major style problems
- **0.0-0.2:** Unacceptable - Does not work or completely wrong

## Output Format

Respond with valid JSON:

```json
{
  "score": 0.85,
  "hits": [
    "Correctly implements the algorithm",
    "Good error handling"
  ],
  "misses": [
    "Missing type hints",
    "No docstring"
  ],
  "reasoning": "Code is correct and handles errors well, but lacks documentation."
}
```
```

## Best Practices

### For Code Evaluators

1. **Focus on relevant fields** - Most evaluators only need the `output` field
2. **Avoid false positives** - Don't check fields like `task` or `expected` unless you specifically need context
3. **Be deterministic** - Same input should always produce same output
4. **Handle errors gracefully** - Return a valid result even when evaluation fails
5. **Provide helpful feedback** - Use `hits` and `misses` to explain the score

### For LLM Judges

1. **Clear criteria** - Define what you're evaluating
2. **Specific guidelines** - Provide scoring rubrics
3. **JSON output** - Enforce structured output format
4. **Examples** - Show what good/bad looks like
5. **Concise prompts** - Keep instructions focused

### Common Pitfalls to Avoid

**❌ Checking unnecessary fields:**
```python
# BAD: Checking 'task' or 'expected' when you only need to validate format
if "async" in input_data.get("task", ""):
    # This creates false positives
```

**✅ Focus on output:**
```python
# GOOD: Only check the actual output
output = input_data.get("output", "")
if "async" in output:
    # This is what you actually want to validate
```

**❌ Brittle string matching:**
```python
# BAD: Exact match is too strict
if output == "The answer is 42":
    score = 1.0
```

**✅ Flexible validation:**
```python
# GOOD: Check for semantic correctness
if "42" in output and "answer" in output.lower():
    score = 1.0
```

## Running Code Evaluators

### In Eval Files

```yaml
execution:
  evaluators:
    - name: my_validator
      type: code
      script: uv run my_validator.py
      cwd: ./evaluators
```

### Command Line Testing

Test your evaluator locally:

```bash
# Create test input
echo '{
  "output": "test output here",
  "task": "test task"
}' | uv run my_validator.py

# Should output:
# {
#   "score": 0.8,
#   "hits": ["check 1 passed"],
#   "misses": ["check 2 failed"],
#   "reasoning": "..."
# }
```

## Advanced Patterns

### Combining Multiple Checks

```python
def evaluate(input_data: dict[str, Any]) -> dict[str, Any]:
    output = input_data.get("output", "")
    
    checks = [
        ("has_async", "async" in output, "Contains async keyword"),
        ("has_await", "await" in output, "Contains await keyword"),
        ("has_try", "try:" in output, "Has error handling"),
    ]
    
    hits = [msg for _, passed, msg in checks if passed]
    misses = [msg for _, passed, msg in checks if not passed]
    score = len(hits) / len(checks)
    
    return {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": f"Passed {len(hits)}/{len(checks)} checks"
    }
```

### Weighted Scoring

```python
def evaluate(input_data: dict[str, Any]) -> dict[str, Any]:
    output = input_data.get("output", "")
    
    # Define checks with weights
    checks = [
        ("correctness", is_correct(output), 0.5),
        ("style", has_good_style(output), 0.3),
        ("docs", has_docs(output), 0.2),
    ]
    
    hits = [name for name, passed, _ in checks if passed]
    misses = [name for name, passed, _ in checks if not passed]
    
    # Weighted score
    score = sum(weight for _, passed, weight in checks if passed)
    
    return {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": f"Weighted score: {score:.2f}"
    }
```
