# Trace-Based Evaluation

Demonstrates how to evaluate agent internals — LLM call counts, tool executions, errors, and step durations — using code graders that inspect `context.trace`.

## Graders

| Grader | File | What it checks |
|-------|------|----------------|
| **Span Count** | `graders/span-count.ts` | Number of LLM calls and tool executions stay within limits |
| **Error Spans** | `graders/error-spans.ts` | No errors in the trace; optionally checks for forbidden tool usage |
| **Span Duration** | `graders/span-duration.ts` | No individual tool call exceeds a time threshold |

## Available Trace Data

Code graders receive `trace` with these fields:

```typescript
interface TraceSummary {
  eventCount: number;                        // Total tool call events
  toolCalls: Record<string, number>;         // Call count per tool (keys are tool names)
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
bun agentv eval examples/features/trace-evaluation/evals/dataset.eval.yaml --dry-run
```

## Patterns

### Threshold validation
Pass configurable limits via `config` in the YAML evaluator block:

```yaml
evaluators:
  - name: span-count
    type: code-grader
    command: ["bun", "run", "../graders/span-count.ts"]
    config:
      maxLlmCalls: 5
      maxToolCalls: 10
```

### Error detection
Check for zero errors and block forbidden tools:

```yaml
evaluators:
  - name: error-check
    type: code-grader
    command: ["bun", "run", "../graders/error-spans.ts"]
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
    type: code-grader
    command: ["bun", "run", "../graders/span-duration.ts"]
    config:
      maxSpanMs: 3000
      maxTotalMs: 15000
```

### Combining graders
Stack multiple trace graders on a single test for comprehensive checks — see the `comprehensive-trace-check` test in `evals/dataset.eval.yaml`.
