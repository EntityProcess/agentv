# Change: Add Extended Execution Metrics

## Why

Tracking **how** agents work is as important as **what** they produce. Currently, AgentV's `TraceSummary` only captures basic tool call counts. Extended metrics like token usage, cost, duration, and efficiency ratios provide valuable signals for:

1. Cost optimization (tokens, API costs)
2. Efficiency analysis (tokens per tool, exploration ratio)
3. Performance tracking (duration, tool latency)

This is infrastructure/data collection - not domain logic. Providers optionally report metrics; the framework aggregates them.

## What Changes

- Add optional execution metrics fields to `TraceSummary` (token usage, cost, duration)
- Add helper functions to compute derived metrics (`explorationRatio`, `tokensPerTool`)
- Make metrics available to evaluators and output writers
- Add example demonstrating metrics-based evaluation

## Impact

- Affected specs: `evaluation`
- Affected code: `packages/core/src/evaluation/trace.ts`, provider types
- Non-breaking: all new fields are optional; existing traces work unchanged

## Implementation Notes

### Data Model
Extend `TraceSummary` (don't create a separate type):
```typescript
// In packages/core/src/evaluation/trace.ts
export interface TraceSummary {
  // Existing fields
  eventCount: number;
  toolNames: string[];
  toolCallsByName: Record<string, number>;
  errorCount: number;

  // NEW optional fields
  tokenUsage?: { input: number; output: number; cached?: number };
  costUsd?: number;
  durationMs?: number;
  toolDurations?: Record<string, number[]>;
}
```

### Provider Response
Extend `ProviderResponse` in `packages/core/src/evaluation/providers/types.ts`:
```typescript
export interface ProviderResponse {
  // Existing fields...

  // NEW optional metrics (providers report what they can)
  tokenUsage?: { input: number; output: number; cached?: number };
  costUsd?: number;
  durationMs?: number;
}
```

### Computed Metrics
Add computation functions in `trace.ts`:
```typescript
// Default exploration tools (can be overridden per-eval via config)
const DEFAULT_EXPLORATION_TOOLS = ['read', 'grep', 'glob', 'search', 'list'];

export function computeExplorationRatio(
  summary: TraceSummary,
  explorationTools: string[] = DEFAULT_EXPLORATION_TOOLS
): number | undefined {
  if (summary.eventCount === 0) return undefined;
  const explorationCalls = explorationTools.reduce(
    (sum, tool) => sum + (summary.toolCallsByName[tool] ?? 0), 0
  );
  return explorationCalls / summary.eventCount;
}
```

### Integration Points
1. **EvaluationContext**: Add `executionMetrics?: TraceSummary` (already has `traceSummary`)
2. **Code judge stdin**: Include metrics in the JSON passed to scripts
3. **JSONL output**: Add `execution_metrics` field to result objects
