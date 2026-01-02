## 1. Data Model

- [x] 1.1 Extend `TraceSummary` type with optional `tokenUsage` field
- [x] 1.2 Add optional `costUsd` field to trace
- [x] 1.3 Add optional `durationMs` field to trace
- [x] 1.4 Add optional `toolDurations` map (tool name -> duration array)

## 2. Computed Metrics

- [x] 2.1 Implement `explorationRatio` computation (configurable exploration tool list)
- [x] 2.2 Implement `tokensPerTool` computation
- [x] 2.3 Add `avgToolDurationMs` computation

## 3. Provider Integration

- [x] 3.1 Define provider metric reporting interface
- [x] 3.2 Update CLI provider to parse and report metrics (token_usage, cost_usd, duration_ms)
- [x] 3.3 Document metric reporting for custom providers (see proposal.md)

## 4. Output & Evaluation

- [x] 4.1 Include metrics in evaluation results JSON
- [x] 4.2 Make metrics available to code judges via stdin
- [x] 4.3 Add metrics to JSONL output format

## 5. Examples & Documentation

- [x] 5.1 Add metrics evaluation example to `examples/features/`
- [x] 5.2 Create code judge example that uses metrics

## 6. Testing

- [x] 6.1 Unit tests for metric computation
- [x] 6.2 Integration test with metric-aware code judge
