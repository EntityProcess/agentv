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

## Custom Provider Metric Reporting

### Overview

Custom providers can optionally report execution metrics by including them in their `ProviderResponse`. These metrics flow through to:
- Evaluation results (JSONL output)
- Code judge scripts (via `traceSummary` in stdin JSON)
- Computed metric functions (`explorationRatio`, `tokensPerTool`, `avgToolDurationMs`)

### ProviderResponse Metrics Contract

```typescript
interface ProviderResponse {
  // Required: output from the provider
  outputMessages?: readonly OutputMessage[];

  // Optional execution metrics
  tokenUsage?: {
    input: number;   // Input/prompt tokens consumed
    output: number;  // Output/completion tokens generated
    cached?: number; // Cached tokens (provider-specific)
  };
  costUsd?: number;    // Total cost in USD
  durationMs?: number; // Execution duration in milliseconds
}
```

### CLI Provider Output Format

CLI-based providers report metrics in their JSON/JSONL output. AgentV parses these fields:

**Single request (JSON):**
```json
{
  "text": "Response content",
  "output_messages": [...],
  "token_usage": { "input": 1000, "output": 500, "cached": 100 },
  "cost_usd": 0.0045,
  "duration_ms": 2500
}
```

**Batch request (JSONL):**
```jsonl
{"id": "case-1", "text": "...", "token_usage": {"input": 800, "output": 400}, "cost_usd": 0.003, "duration_ms": 1500}
{"id": "case-2", "text": "...", "token_usage": {"input": 1200, "output": 600}, "cost_usd": 0.005, "duration_ms": 2000}
```

### Duration Fallback

If a provider doesn't report `duration_ms`:
- **Single request**: AgentV uses wall-clock time of the provider invocation
- **Batch request**: AgentV divides total wall-clock time by request count

### Implementation Guide for Custom Providers

1. **Track metrics during execution:**
   ```typescript
   const startTime = Date.now();
   const result = await callLLM(request);
   const durationMs = Date.now() - startTime;
   ```

2. **Extract token usage from LLM response:**
   ```typescript
   const tokenUsage = {
     input: result.usage.prompt_tokens,
     output: result.usage.completion_tokens,
     cached: result.usage.cached_tokens, // if available
   };
   ```

3. **Calculate cost (if pricing is known):**
   ```typescript
   const inputCost = tokenUsage.input * INPUT_PRICE_PER_TOKEN;
   const outputCost = tokenUsage.output * OUTPUT_PRICE_PER_TOKEN;
   const costUsd = inputCost + outputCost;
   ```

4. **Return in ProviderResponse:**
   ```typescript
   return {
     outputMessages: [...],
     tokenUsage,
     costUsd,
     durationMs,
   };
   ```

### Metrics in Code Judges

Code judges receive metrics via `traceSummary` in their stdin JSON:

```json
{
  "question": "...",
  "candidateAnswer": "...",
  "traceSummary": {
    "eventCount": 5,
    "toolNames": ["Read", "Edit"],
    "toolCallsByName": { "Read": 3, "Edit": 2 },
    "errorCount": 0,
    "tokenUsage": { "input": 1000, "output": 500 },
    "costUsd": 0.0045,
    "durationMs": 2500
  }
}
```

Code judges can use these for efficiency-based evaluation:
- Penalize excessive token usage
- Score based on cost efficiency
- Check execution time thresholds
