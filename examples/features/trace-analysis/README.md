# Trace Analysis Example

Demonstrates `agentv trace` subcommands for headless trace inspection and analysis.

## Quick Start

```bash
# List result files
bun agentv trace list

# Show results with trace details from the default exported trace file
bun agentv trace show .agentv/results/raw/eval_<timestamp>/trace.jsonl

# Show hierarchical trace tree
bun agentv trace show .agentv/results/raw/eval_<timestamp>/trace.jsonl --tree

# Filter to a specific test
bun agentv trace show .agentv/results/raw/eval_<timestamp>/trace.jsonl --test-id research-question --tree

# Compute percentile statistics
bun agentv trace stats .agentv/results/raw/eval_<timestamp>/trace.jsonl

# Group stats by target provider
bun agentv trace stats .agentv/results/raw/eval_<timestamp>/trace.jsonl --group-by target

# JSON output for piping to jq
bun agentv trace stats .agentv/results/raw/eval_<timestamp>/trace.jsonl --format json | jq '.groups[].metrics'
```

## What's in the Example Data

The sample run workspace contains 5 test results from a multi-agent evaluation. `trace` accepts the
workspace directory directly for summary fallback, but full tool-call inspection should read the
exported `trace.jsonl` file.

| Test ID | Score | Target | Trace |
|---|---|---|---|
| research-question | 75% | gpt-4o | 8 tool calls, $0.105, 15.1s |
| code-review-task | 100% | gpt-4o | 3 tool calls, $0.032, 4.5s |
| data-analysis | 50% | claude-sonnet | 12 tool calls, $0.180, 28s |
| simple-qa | 100% | gpt-4o | 0 tool calls, $0.005, 1.2s |
| multi-step-planning | 90% | claude-sonnet | 6 tool calls, $0.065, 9.5s |

Two results include full `output` messages for tree view rendering.

## Composability

Pipe JSON output to `jq` for complex queries:

```bash
# Find tests that cost more than $0.10
bun agentv trace show .agentv/results/raw/eval_<timestamp>/trace.jsonl --format json \
  | jq '[.[] | select(.cost_usd > 0.10) | {test_id, score, cost: .cost_usd}]'

# Compare scores by target provider
bun agentv trace stats .agentv/results/raw/eval_<timestamp>/trace.jsonl --group-by target --format json \
  | jq '.groups[] | {label, score_mean: .metrics.score.mean}'
```
