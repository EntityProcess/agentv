# Composite Evaluator Guide

Composite evaluators combine multiple evaluators and aggregate their results. This enables sophisticated evaluation patterns like safety gates, weighted scoring, and conflict resolution.

## Basic Structure

```yaml
execution:
  evaluators:
    - name: my_composite
      type: composite
      evaluators:
        - name: evaluator_1
          type: llm_judge
          prompt: ./prompts/check1.md
        - name: evaluator_2
          type: code_judge
          script: uv run check2.py
      aggregator:
        type: weighted_average
        weights:
          evaluator_1: 0.6
          evaluator_2: 0.4
```

## Aggregator Types

### 1. Weighted Average (Default)

Combines scores using weighted arithmetic mean:

```yaml
aggregator:
  type: weighted_average
  weights:
    safety: 0.3      # 30% weight
    quality: 0.7     # 70% weight
```

If weights are omitted, all evaluators have equal weight (1.0).

**Score calculation:**
```
final_score = Σ(score_i × weight_i) / Σ(weight_i)
```

### 2. Code Judge Aggregator

Run custom code to decide final score based on all evaluator results:

```yaml
aggregator:
  type: code_judge
  path: node ./scripts/safety-gate.js
  cwd: ./evaluators  # optional working directory
```

**Input (stdin):**
```json
{
  "results": {
    "safety": { "score": 0.9, "hits": [...], "misses": [...] },
    "quality": { "score": 0.85, "hits": [...], "misses": [...] }
  }
}
```

**Output (stdout):**
```json
{
  "score": 0.87,
  "verdict": "pass",
  "hits": ["Combined check passed"],
  "misses": [],
  "reasoning": "Safety gate passed, quality acceptable"
}
```

### 3. LLM Judge Aggregator

Use an LLM to resolve conflicts or make nuanced decisions:

```yaml
aggregator:
  type: llm_judge
  prompt: ./prompts/conflict-resolution.md
```

The `{{EVALUATOR_RESULTS_JSON}}` variable is replaced with the JSON results from all child evaluators.

## Example Patterns

### Safety Gate Pattern

Block outputs that fail safety even if quality is high:

```yaml
evalcases:
  - id: safety-gated-response
    expected_outcome: Safe and accurate response
    
    input_messages:
      - role: user
        content: Explain quantum computing
    
    execution:
      evaluators:
        - name: safety_gate
          type: composite
          evaluators:
            - name: safety
              type: llm_judge
              prompt: ./prompts/safety-check.md
            - name: quality
              type: llm_judge
              prompt: ./prompts/quality-check.md
          aggregator:
            type: code_judge
            path: |
              // Safety gate: if safety < 0.9, fail regardless of quality
              const results = JSON.parse(require('fs').readFileSync(0, 'utf8'));
              const safety = results.results.safety.score;
              const quality = results.results.quality.score;
              
              if (safety < 0.9) {
                console.log(JSON.stringify({
                  score: 0,
                  verdict: "fail",
                  reasoning: "Safety threshold not met"
                }));
              } else {
                console.log(JSON.stringify({
                  score: (safety * 0.3 + quality * 0.7),
                  verdict: "pass",
                  reasoning: "Safety passed, quality weighted"
                }));
              }
```

### Multi-Criteria Weighted Evaluation

```yaml
- name: release_readiness
  type: composite
  evaluators:
    - name: correctness
      type: llm_judge
      prompt: ./prompts/correctness.md
    - name: style
      type: code_judge
      script: uv run style_checker.py
    - name: security
      type: llm_judge
      prompt: ./prompts/security.md
  aggregator:
    type: weighted_average
    weights:
      correctness: 0.5
      style: 0.2
      security: 0.3
```

### Nested Composites

Composites can contain other composites for complex hierarchies:

```yaml
- name: comprehensive_eval
  type: composite
  evaluators:
    - name: content_quality
      type: composite
      evaluators:
        - name: accuracy
          type: llm_judge
          prompt: ./prompts/accuracy.md
        - name: clarity
          type: llm_judge
          prompt: ./prompts/clarity.md
      aggregator:
        type: weighted_average
        weights:
          accuracy: 0.6
          clarity: 0.4
    - name: safety
      type: llm_judge
      prompt: ./prompts/safety.md
  aggregator:
    type: weighted_average
    weights:
      content_quality: 0.7
      safety: 0.3
```

## Result Structure

Composite evaluators return nested `evaluator_results`:

```json
{
  "score": 0.85,
  "verdict": "pass",
  "hits": ["[safety] No harmful content", "[quality] Clear explanation"],
  "misses": ["[quality] Could use more examples"],
  "reasoning": "safety: Passed all checks; quality: Good but could improve",
  "evaluator_results": [
    {
      "name": "safety",
      "type": "llm_judge",
      "score": 0.95,
      "verdict": "pass",
      "hits": ["No harmful content"],
      "misses": []
    },
    {
      "name": "quality", 
      "type": "llm_judge",
      "score": 0.8,
      "verdict": "pass",
      "hits": ["Clear explanation"],
      "misses": ["Could use more examples"]
    }
  ]
}
```

## Best Practices

1. **Name evaluators clearly** - Names appear in results and debugging output
2. **Use safety gates for critical checks** - Don't let high quality override safety failures
3. **Balance weights thoughtfully** - Consider which aspects matter most for your use case
4. **Keep nesting shallow** - Deep nesting makes debugging harder
5. **Test aggregators independently** - Verify your custom aggregation logic with unit tests
