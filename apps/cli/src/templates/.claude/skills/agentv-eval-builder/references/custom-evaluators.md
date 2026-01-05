# Custom Evaluators Guide

Guide for writing custom code evaluators and LLM judges for AgentV eval files.

## Code Evaluator Contract

Code evaluators receive input via stdin and write output to stdout, both as JSON.

### Input Format (via stdin)

Wire format uses snake_case for cross-language compatibility:

```json
{
  "question": "string describing the task/question",
  "expected_outcome": "expected outcome description",
  "reference_answer": "gold standard answer (optional)",
  "candidate_answer": "generated code/text from the agent",
  "guideline_files": ["path1", "path2"],
  "input_files": ["file1", "file2"],
  "input_messages": [{"role": "user", "content": "..."}],
  "output_messages": [
    {
      "role": "assistant",
      "content": "...",
      "tool_calls": [
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
  "trace_summary": {
    "event_count": 5,
    "tool_names": ["fetch", "search"],
    "tool_calls_by_name": { "search": 2, "fetch": 1 },
    "error_count": 0,
    "token_usage": { "input": 1000, "output": 500 },
    "cost_usd": 0.0015,
    "duration_ms": 3500
  }
}
```

**Key fields:**
- `output_messages` - Full agent execution trace with tool calls (use `tool_calls[].input` for arguments)
- `trace_summary` - Lightweight summary with execution metrics (counts only, no tool arguments)

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

## TypeScript Code Evaluator Template (with SDK)

The optional `@agentv/core` SDK provides type-safe payload parsing with camelCase properties (`candidateAnswer` vs `candidate_answer`).

**Execution:** Keep evaluators as `.ts` files and run via Node loaders like `npx --yes tsx ./evaluators/my-check.ts` so users don't need Bun after `npm install -g agentv`.

**Without SDK:** Skip the import and parse JSON from stdin directly (similar to the Python template above).

```typescript
/**
 * Example TypeScript code evaluator using the AgentV SDK
 *
 * Run with: npx --yes tsx ./evaluators/example-check.ts
 *
 * The SDK provides:
 * - Type-safe CodeJudgePayload interface with all fields
 * - camelCase properties (candidateAnswer, expectedOutcome, etc.)
 * - Automatic conversion from snake_case wire format
 */

import { readCodeJudgePayload } from '@agentv/core';

try {
  // Read and parse stdin with automatic snake_case → camelCase conversion
  const payload = readCodeJudgePayload();

  // Type-safe camelCase access to all fields
  const { candidateAnswer, expectedOutcome, inputFiles, guidelineFiles } = payload;

  // Your validation logic here
  const hits: string[] = [];
  const misses: string[] = [];

  // Example: Check if answer contains expected outcome
  if (candidateAnswer.includes(expectedOutcome)) {
    hits.push('Answer matches expected outcome');
  } else {
    misses.push('Answer does not match expected outcome');
  }

  // Example: Check attachment mentions
  const attachments = [...guidelineFiles, ...inputFiles];
  for (const filePath of attachments) {
    const fileName = filePath.split('/').pop() ?? filePath;
    if (candidateAnswer.includes(fileName)) {
      hits.push(`Mentions attachment: ${fileName}`);
    } else {
      misses.push(`Missing attachment: ${fileName}`);
    }
  }

  // Calculate score
  const totalChecks = hits.length + misses.length;
  const score = totalChecks === 0 ? 0 : hits.length / totalChecks;

  // Build result
  const result = {
    score,
    hits,
    misses,
    reasoning: `Passed ${hits.length}/${totalChecks} checks`
  };

  console.log(JSON.stringify(result, null, 2));

} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({
    score: 0,
    hits: [],
    misses: [`Error: ${message}`],
    reasoning: 'Evaluator error'
  }, null, 2));
  process.exit(1);
}
```

**TypeScript SDK Benefits:**
- **Type-safe**: `CodeJudgePayload` interface with all fields typed
- **camelCase**: Idiomatic TypeScript naming (`candidateAnswer` vs `candidate_answer`)
- **Automatic conversion**: Handles snake_case wire format → camelCase objects
- **Compile-time safety**: Catch typos and missing fields before runtime

**Available in SDK:**
- `readCodeJudgePayload()`: Read stdin and convert to camelCase (recommended)
- `parseCodeJudgePayload(jsonString)`: Parse JSON string and convert to camelCase
- `CodeJudgePayload`: TypeScript interface for type safety

**See also:** `examples/features/code-judge-sdk/` for complete working examples

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

TypeScript evaluators use the same structure but invoke `tsx` (or another Node-compatible loader) so they work everywhere:

```yaml
execution:
  evaluators:
    - name: csv_guardrail
      type: code_judge
      script: npx --yes tsx ./evaluators/check-csv.ts
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

```bash
# TypeScript (uses tsx loader under Node)
echo '{
  "candidate_answer": "test output here",
  "question": "test task",
  "expected_outcome": "expected result"
}' | npx --yes tsx ./evaluators/check-csv.ts
```
