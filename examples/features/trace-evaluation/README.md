# Trace-Based Evaluation

Demonstrates how to evaluate agent internals — LLM call counts, tool executions, errors, and step durations — using code judges that inspect `context.traceSummary`.

## Judges

| Judge | File | What it checks |
|-------|------|----------------|
| **Span Count** | `judges/span-count.ts` | Number of LLM calls and tool executions stay within limits |
| **Error Spans** | `judges/error-spans.ts` | No errors in the trace; optionally checks for forbidden tool usage |
| **Span Duration** | `judges/span-duration.ts` | No individual tool call exceeds a time threshold |

## Available Trace Data

Code judges receive `traceSummary` with these fields:

```typescript
interface TraceSummary {
  eventCount: number;                        // Total tool call events
  toolNames: string[];                       // Unique tool names used
  toolCallsByName: Record<string, number>;   // Call count per tool
  errorCount: number;                        // Number of errors
  tokenUsage?: { input: number; output: number; cached?: number };
  costUsd?: number;                          // Total cost in USD
  durationMs?: number;                       // Total execution time
  toolDurations?: Record<string, number[]>;  // Per-tool durations
  llmCallCount?: number;                     // Number of LLM calls
  startTime?: string;                        // ISO timestamp
  endTime?: string;                          // ISO timestamp
}
```

## Running

```bash
# From the repository root (dry-run mode for testing without a live agent)
bun agentv eval examples/features/trace-evaluation/evals/dataset.yaml --dry-run
```

## Patterns

### Threshold validation
Pass configurable limits via `config` in the YAML evaluator block:

```yaml
evaluators:
  - name: span-count
    type: code_judge
    script: ["bun", "run", "../judges/span-count.ts"]
    config:
      maxLlmCalls: 5
      maxToolCalls: 10
```

### Error detection
Check for zero errors and block forbidden tools:

```yaml
evaluators:
  - name: error-check
    type: code_judge
    script: ["bun", "run", "../judges/error-spans.ts"]
    config:
      maxErrors: 0
      forbiddenTools:
        - execute_code
```

### Duration limits
Ensure no individual step or total execution exceeds time budgets:

```yaml
evaluators:
  - name: duration-check
    type: code_judge
    script: ["bun", "run", "../judges/span-duration.ts"]
    config:
      maxSpanMs: 3000
      maxTotalMs: 15000
```

### Combining judges
Stack multiple trace judges on a single test for comprehensive checks — see the `comprehensive-trace-check` test in `evals/dataset.yaml`.
