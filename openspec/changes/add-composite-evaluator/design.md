# Design: Composite Evaluator

## Architecture

The `CompositeEvaluator` acts as an orchestrator. It implements the `Evaluator` interface, runs a set of child evaluators, and then combines their results via a dedicated aggregator.

### Class Structure

```typescript
export class CompositeEvaluator implements Evaluator {
  readonly kind = 'composite';

  constructor(
    private config: CompositeEvaluatorConfig,
    private evaluatorFactory: EvaluatorFactory // To instantiate child evaluators
  ) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // 1. Instantiate and run evaluators in parallel
    const memberResults = await Promise.all(
      this.config.evaluators.map(async (memberConfig) => {
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
    switch (this.config.aggregator.type) {
      case 'code_judge':
        return this.runCodeAggregator(results, this.config.aggregator.path);
      case 'llm_judge':
        return this.runLlmAggregator(results, context, this.config.aggregator.prompt);
      case 'weighted_average':
      default:
        return this.runWeightedAverage(results, this.config.aggregator.weights);
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
export type CompositeAggregatorConfig = 
  | { type: 'weighted_average'; weights?: Record<string, number> }
  | { type: 'code_judge'; path: string }
  | { type: 'llm_judge'; prompt?: string; model?: string }; // prompt supports file path resolution

export type CompositeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'composite';
  readonly evaluators: EvaluatorConfig[];
  readonly aggregator: CompositeAggregatorConfig;
};
```

### YAML naming conventions

- Use `type: code_judge` for the code-based evaluator in YAML.
- Do not support `type: code`.

### Meta-Judge Interfaces

#### Code Aggregator
The code script is executed as a child process, consistent with the existing code-evaluator execution model.
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

#### LLM Aggregator
The LLM receives a prompt containing the JSON representation of all evaluator results.
*   **Input Format**: The `{{EVALUATOR_RESULTS_JSON}}` variable will be replaced by `JSON.stringify(Record<string, EvaluationScore>, null, 2)`.
*   **Output Format**: The LLM must return a JSON object matching the standard `EvaluationScore` schema (score, verdict, reasoning).
*   **Prompt Resolution**: The `prompt` property supports a file path. If the value resolves to a file, the content is loaded. Otherwise, the value is treated as the prompt string itself.

```text
// Default Meta-Judge Prompt
Review the following evaluation results:
{{EVALUATOR_RESULTS_JSON}}

Decide the final score and verdict.
```

## Configuration Examples

### 1. Weighted Average
Combines a safety check and a quality check, giving equal weight.

```yaml
evaluators:
  - name: "release_gate"
    type: "composite"
    evaluators:
      - name: "safety"
        type: "llm_judge"
        prompt: "Is this safe?"
      - name: "quality"
        type: "llm_judge"
        prompt: "Is this high quality?"
    aggregator:
      type: "weighted_average"
      weights:
        safety: 0.5
        quality: 0.5
```

### 2. Code Aggregator (Safety Gate)
Uses a script to enforce a hard failure if the safety check fails, otherwise uses the quality score.

```yaml
evaluators:
  - name: "safety_gate"
    type: "composite"
    evaluators:
      - name: "safety"
        type: "llm_judge"
        prompt: "Is this safe?"
      - name: "quality"
        type: "llm_judge"
        prompt: "Is this high quality?"
    aggregator:
      type: "code_judge"
      path: "./scripts/safety-gate.js"
```

### 3. LLM Aggregator
Asks an LLM to review conflicting results and make a final decision.

```yaml
evaluators:
  - name: "final_decision"
    type: "composite"
    evaluators:
      - name: "conciseness"
        type: "llm_judge"
        prompt: "Is it concise?"
      - name: "detail"
        type: "llm_judge"
        prompt: "Is it detailed?"
    aggregator:
      type: "llm_judge"
      prompt: |
        Review the child evaluator results. 
        If 'conciseness' and 'detail' conflict, prioritize detail for this task.
        {{EVALUATOR_RESULTS_JSON}}
```

## Trade-offs
*   **Complexity vs. Power**: Adds complexity to the configuration but enables powerful "Gatekeeper" patterns that are impossible with single evaluators.
*   **Latency**: Running multiple evaluators increases total compute/token usage, though parallel execution mitigates wall-clock time.
