# Design: Composite Evaluator

## Architecture

The `CompositeEvaluator` acts as an orchestrator. It implements the `Evaluator` interface but delegates the actual assessment to its members.

### Class Structure

```typescript
export class CompositeEvaluator implements Evaluator {
  readonly kind = 'composite';

  constructor(
    private config: CompositeEvaluatorConfig,
    private evaluatorFactory: EvaluatorFactory // To instantiate members
  ) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // 1. Instantiate and run members in parallel
    const memberResults = await Promise.all(
      this.config.members.map(async (memberConfig) => {
        const evaluator = this.evaluatorFactory.create(memberConfig);
        return {
          id: memberConfig.name,
          result: await evaluator.evaluate(context)
        };
      })
    );

    // 2. Aggregate results
    return this.aggregate(memberResults, context);
  }

  private async aggregate(
    results: MemberResult[], 
    context: EvaluationContext
  ): Promise<EvaluationScore> {
    switch (this.config.aggregation.strategy) {
      case 'code_judge':
        return this.runCodeMetaJudge(results, this.config.aggregation.code);
      case 'llm_judge':
        return this.runLlmMetaJudge(results, context, this.config.aggregation.prompt);
      case 'weighted_average':
      default:
        return this.runWeightedAverage(results, this.config.aggregation.weights);
    }
  }
}

interface MemberResult {
  id: string;
  result: EvaluationScore;
}
```

### Configuration

```typescript
export type AggregationConfig = 
  | { strategy: 'weighted_average'; weights?: Record<string, number> }
  | { strategy: 'code_judge'; code: string }
  | { strategy: 'llm_judge'; prompt?: string; model?: string };

export type CompositeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'composite';
  readonly members: EvaluatorConfig[];
  readonly aggregation: AggregationConfig;
};
```

### Meta-Judge Interfaces

#### Code Meta-Judge
The code script is executed as a child process, consistent with the existing `CodeEvaluator`.
*   **Input**: The script receives a JSON payload via `stdin` containing the `results` object (mapping member names to `EvaluationScore`).
*   **Output**: The script must print a JSON object to `stdout` matching the `EvaluationScore` schema (or a partial version with at least `score`).
*   **Execution**: Uses `child_process.spawn` with `shell: true`.

```javascript
// Example Code Meta-Judge (Node.js script)
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf-8')); // Read from stdin

const results = input.results;

let finalScore = 0;
let verdict = 'fail';
let reasoning = '';

if (results['safety'].verdict === 'fail') {
  finalScore = 0;
  verdict = 'fail';
  reasoning = 'Safety check failed';
} else {
  finalScore = results['quality'].score;
  verdict = results['quality'].verdict;
  reasoning = 'Safety passed, score based on quality';
}

console.log(JSON.stringify({ score: finalScore, verdict, reasoning }));
```

#### LLM Meta-Judge
The LLM receives a prompt containing the JSON representation of all member results.
*   **Input Format**: The `{{MEMBER_RESULTS_JSON}}` variable will be replaced by `JSON.stringify(Record<string, EvaluationScore>, null, 2)`.
*   **Output Format**: The LLM must return a JSON object matching the standard `EvaluationScore` schema (score, verdict, reasoning).

```text
// Default Meta-Judge Prompt
Review the following evaluation results:
{{MEMBER_RESULTS_JSON}}

Decide the final score and verdict.
```

## Configuration Examples

### 1. Weighted Average
Combines a safety check and a quality check, giving equal weight.

```yaml
evaluators:
  - name: "release_gate"
    type: "composite"
    members:
      - name: "safety"
        type: "llm_judge"
        prompt: "Is this safe?"
      - name: "quality"
        type: "llm_judge"
        prompt: "Is this high quality?"
    aggregation:
      strategy: "weighted_average"
      weights:
        safety: 0.5
        quality: 0.5
```

### 2. Code Meta-Judge (Safety Gate)
Uses a script to enforce a hard failure if the safety check fails, otherwise uses the quality score.

```yaml
evaluators:
  - name: "safety_gate"
    type: "composite"
    members:
      - name: "safety"
        type: "llm_judge"
        prompt: "Is this safe?"
      - name: "quality"
        type: "llm_judge"
        prompt: "Is this high quality?"
    aggregation:
      strategy: "code_judge"
      code: "./scripts/safety-gate.js"
```

### 3. LLM Meta-Judge
Asks an LLM to review conflicting results and make a final decision.

```yaml
evaluators:
  - name: "final_decision"
    type: "composite"
    members:
      - name: "conciseness"
        type: "llm_judge"
        prompt: "Is it concise?"
      - name: "detail"
        type: "llm_judge"
        prompt: "Is it detailed?"
    aggregation:
      strategy: "llm_judge"
      prompt: |
        Review the sub-evaluator results. 
        If 'conciseness' and 'detail' conflict, prioritize detail for this task.
        {{MEMBER_RESULTS_JSON}}
```

## Trade-offs
*   **Complexity vs. Power**: Adds complexity to the configuration but enables powerful "Gatekeeper" patterns that are impossible with single evaluators.
*   **Latency**: Running multiple evaluators increases total compute/token usage, though parallel execution mitigates wall-clock time.
