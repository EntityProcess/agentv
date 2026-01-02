# Custom Evaluators Guide

Guide for writing custom code evaluators and LLM judges for AgentV eval files.

## Code Evaluator Contract

Code evaluators receive input via stdin and write output to stdout, both as JSON.

### Input Format (via stdin)

```json
{
  "question": "string describing the task/question",
  "expectedOutcome": "expected outcome description",
  "referenceAnswer": "gold standard answer (optional)",
  "candidateAnswer": "generated code/text from the agent",
  "guidelineFiles": ["path1", "path2"],
  "inputFiles": ["file1", "file2"],
  "inputMessages": [{"role": "user", "content": "..."}],
  "outputMessages": [
    {
      "role": "assistant",
      "content": "...",
      "toolCalls": [
        {
          "tool": "search",
          "input": { "query": "..." },
          "output": { "results": [...] },
          "id": "call_123",
          "timestamp": "2024-01-15T10:30:00Z"
        }
      ]
    }
  ],
  "traceSummary": {
    "eventCount": 5,
    "toolNames": ["fetch", "search"],
    "toolCallsByName": { "search": 2, "fetch": 1 },
    "errorCount": 0,
    "tokenUsage": { "input": 1000, "output": 500 },
    "costUsd": 0.0015,
    "durationMs": 3500
  }
}
```

**Key fields:**
- `outputMessages` - Full agent execution trace with tool calls (use `toolCalls[].input` for arguments)
- `traceSummary` - Lightweight summary with execution metrics (counts only, no tool arguments)

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
    # Most evaluators only need 'candidate_answer' - avoid using unnecessary fields
    candidate_answer = input_data.get("candidate_answer", "")
    
    # Your validation logic here
    hits = []
    misses = []
    
    # Example: Check for keywords
    required_keywords = ["async", "await"]
    for keyword in required_keywords:
        if keyword in candidate_answer:
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

## LLM Judge Prompt Template

LLM judges use markdown prompts to guide evaluation. AgentV automatically handles the output format, so focus your prompt on evaluation criteria and guidelines.

**Available Template Variables:**
- `{{question}}` - The original question/task
- `{{expected_outcome}}` - What the answer should accomplish
- `{{candidate_answer}}` - The actual output to evaluate
- `{{reference_answer}}` - Gold standard answer (optional, may be empty)
- `{{input_messages}}` - JSON stringified input message segments
- `{{output_messages}}` - JSON stringified expected output segments

**Default Evaluator Template:**

If you don't specify a custom evaluator template, AgentV uses this default:

```
You are an expert evaluator. Your goal is to grade the candidate_answer based on how well it achieves the expected_outcome for the original task.

Use the reference_answer as a gold standard for a high-quality response (if provided). The candidate_answer does not need to match it verbatim, but should capture the key points and follow the same spirit.

Be concise and focused in your evaluation. Provide succinct, specific feedback rather than verbose explanations.

[[ ## expected_outcome ## ]]
{{expected_outcome}}

[[ ## question ## ]]
{{question}}

[[ ## reference_answer ## ]]
{{reference_answer}}

[[ ## candidate_answer ## ]]
{{candidate_answer}}
```

You can customize this template in your eval file using the `evaluatorTemplate` field to add domain-specific criteria or scoring guidelines.

## Best Practices

### For Code-based Evaluators

1. **Focus on relevant fields** - Most evaluators only need the `candidate_answer` field
2. **Avoid false positives** - Don't check fields like `question` or `reference_answer` unless you specifically need context
3. **Be deterministic** - Same input should always produce same output
4. **Handle errors gracefully** - Return a valid result even when evaluation fails
5. **Provide helpful feedback** - Use `hits` and `misses` to explain the score

### For Prompt-based Evaluators (LLM Judges)

1. **Clear criteria** - Define what you're evaluating
2. **Specific guidelines** - Provide scoring rubrics
3. **JSON output** - Enforce structured output format
4. **Examples** - Show what good/bad looks like
5. **Concise prompts** - Keep instructions focused

## Running Code Evaluators

### In Eval Files

```yaml
execution:
  evaluators:
    - name: my_validator
      type: code_judge
      script: uv run my_validator.py
      cwd: ./evaluators
```

### Command Line Testing

Test your evaluator locally:

```bash
# Create test input
echo '{
  "candidate_answer": "test output here",
  "question": "test task",
  "expected_outcome": "expected result"
}' | uv run my_validator.py

# Should output:
# {
#   "score": 0.8,
#   "hits": ["check 1 passed"],
#   "misses": ["check 2 failed"],
#   "reasoning": "..."
# }
```
