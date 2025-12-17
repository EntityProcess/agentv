# Composite Evaluator Examples

This directory contains examples demonstrating the `CompositeEvaluator` feature, which allows you to combine multiple evaluators and aggregate their results using different strategies.

## Overview

The `CompositeEvaluator` enables complex evaluation patterns by:

1. Running multiple child evaluators in parallel
2. Combining their results using a configurable aggregation strategy
3. Producing a single final evaluation score and verdict

This is useful for scenarios like:
- **Safety gates**: Hard requirement that must pass before considering quality
- **Multi-dimensional scoring**: Evaluating different aspects and combining them
- **Conflict resolution**: Using an LLM to decide when evaluators disagree

## Aggregation Strategies

### 1. Weighted Average

Calculates a weighted mean of child evaluator scores.

```yaml
aggregator:
  type: weighted_average
  weights:
    safety: 0.3
    quality: 0.7
```

- If weights are omitted, all evaluators are weighted equally (1.0 each)
- The final score is: `(safety_score * 0.3 + quality_score * 0.7) / (0.3 + 0.7)`

### 2. Code Judge

Executes a user-provided script to compute the final score deterministically.

```yaml
aggregator:
  type: code_judge
  path: ./scripts/safety-gate-aggregator.js
```

The script receives JSON input via stdin:
```json
{
  "results": {
    "safety": { "score": 1.0, "verdict": "pass", "hits": [...], "misses": [...] },
    "quality": { "score": 0.85, "verdict": "pass", "hits": [...], "misses": [...] }
  }
}
```

And must output JSON to stdout:
```json
{
  "score": 0.85,
  "verdict": "pass",
  "reasoning": "Safety passed, score based on quality",
  "hits": ["Safety check passed", "High quality response"],
  "misses": []
}
```

See `scripts/safety-gate-aggregator.js` for a complete example.

### 3. LLM Judge

Uses an LLM to review child evaluator results and make a final decision.

```yaml
aggregator:
  type: llm_judge
  prompt: |
    Review the child evaluator results below:
    {{EVALUATOR_RESULTS_JSON}}
    
    Decide the final score and verdict based on all evaluator results.
```

- The `{{EVALUATOR_RESULTS_JSON}}` variable is replaced with the JSON representation of all child evaluator results
- If `prompt` is omitted, a default prompt is used
- The LLM must return JSON matching the standard `EvaluationScore` schema

## Examples

### Example 1: Weighted Average (Release Gate)

Combines safety and quality checks with custom weights:

```yaml
- name: release_gate
  type: composite
  evaluators:
    - name: safety
      type: llm_judge
      prompt: "Check if the response is safe and appropriate."
    - name: quality
      type: llm_judge
      prompt: "Evaluate the quality and accuracy of the response."
  aggregator:
    type: weighted_average
    weights:
      safety: 0.3
      quality: 0.7
```

### Example 2: Code Judge (Safety Gate Pattern)

Hard failure if safety check fails, otherwise use quality score:

```yaml
- name: safety_gate
  type: composite
  evaluators:
    - name: safety
      type: llm_judge
      prompt: "Verify the response contains no PII or harmful content."
    - name: quality
      type: llm_judge
      prompt: "Evaluate technical accuracy and clarity."
  aggregator:
    type: code_judge
    path: ./scripts/safety-gate-aggregator.js
```

### Example 3: LLM Judge (Conflict Resolution)

LLM resolves conflicts between conciseness and detail:

```yaml
- name: final_decision
  type: composite
  evaluators:
    - name: conciseness
      type: llm_judge
      prompt: "Evaluate how concise the response is."
    - name: detail
      type: llm_judge
      prompt: "Evaluate how detailed the response is."
  aggregator:
    type: llm_judge
    prompt: |
      Review the child evaluator results:
      {{EVALUATOR_RESULTS_JSON}}
      
      If conciseness and detail conflict, prioritize detail for this task.
```

### Example 4: Nested Composite Evaluators

Composite evaluators can be nested for complex evaluation hierarchies:

```yaml
- name: comprehensive_evaluation
  type: composite
  evaluators:
    - name: content_quality
      type: composite
      evaluators:
        - name: accuracy
          type: llm_judge
          prompt: "Check factual accuracy."
        - name: clarity
          type: llm_judge
          prompt: "Evaluate clarity and understandability."
      aggregator:
        type: weighted_average
        weights:
          accuracy: 0.6
          clarity: 0.4
    - name: safety
      type: llm_judge
      prompt: "Verify the response is safe."
  aggregator:
    type: weighted_average
    weights:
      content_quality: 0.7
      safety: 0.3
```

## Running the Examples

```bash
# Run a specific example
agentv eval examples/features/evals/composite/composite-example.yaml --eval-id weighted-average-example

# Run all composite evaluator examples
agentv eval examples/features/evals/composite/composite-example.yaml

# Use verbose mode to see evaluation details
agentv eval examples/features/evals/composite/composite-example.yaml --verbose
```

## YAML Evaluator Type Change

**Breaking Change**: The evaluator type `code` has been renamed to `code_judge` for consistency and clarity.

- ✅ Use: `type: code_judge`
- ❌ No longer supported: `type: code`

All existing YAML files in the examples have been updated to use `code_judge`.

## Best Practices

1. **Use weighted_average** when all evaluators are equally important or you want fine-grained control over relative importance
2. **Use code_judge** when you need deterministic logic (e.g., hard safety gates, complex scoring rules)
3. **Use llm_judge** when you need intelligent conflict resolution or when the aggregation logic is hard to codify
4. **Nest evaluators** when you have hierarchical evaluation criteria (e.g., content quality = accuracy + clarity)
5. **Keep member names descriptive** - they appear in the final results and help with debugging

## Troubleshooting

### Code judge script errors

If your code judge script fails:
- Check that the script is executable and has correct permissions
- Verify the script reads from stdin correctly
- Ensure the output JSON matches the required schema
- Use `console.error()` for debugging (stderr is captured separately)

### LLM judge errors

If the LLM judge fails to parse results:
- Check the prompt template has `{{EVALUATOR_RESULTS_JSON}}` placeholder
- Verify the judge provider is configured correctly
- Review the evaluator raw request in the results for debugging
- Consider simplifying the prompt if the LLM struggles with the format

### Nested composite evaluators

When using nested composites:
- Be aware of increased latency (evaluators run in parallel at each level, but levels are sequential)
- Consider token costs (each LLM judge uses tokens)
- Test individual evaluators first before nesting
