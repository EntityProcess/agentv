# Execution Metrics

Demonstrates execution metrics tracking (tokens, cost, latency) in evaluations.

## What This Shows

- Automatic token usage tracking (input, output, cached)
- Cost tracking in USD
- Execution duration in milliseconds
- Using metrics in code judges for performance evaluation
- Metrics available in evaluation results

## Running

```bash
# From repository root
cd examples/features
bun agentv eval execution-metrics/evals/dataset.eval.yaml --target mock_metrics_agent
```

## Setup

Create `.env` in `examples/features/`:

```env
EXECUTION_METRICS_DIR=/absolute/path/to/examples/features/execution-metrics
```

## Key Files

- `evals/dataset.eval.yaml` - Test cases showing metrics collection
- Mock agent automatically returns realistic execution metrics
