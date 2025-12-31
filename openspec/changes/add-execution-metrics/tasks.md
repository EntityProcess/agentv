## 1. Data Model

- [ ] 1.1 Extend `TraceSummary` type with optional `tokenUsage` field
- [ ] 1.2 Add optional `costUsd` field to trace
- [ ] 1.3 Add optional `durationMs` field to trace
- [ ] 1.4 Add optional `toolDurations` map (tool name -> duration array)

## 2. Computed Metrics

- [ ] 2.1 Implement `explorationRatio` computation (configurable exploration tool list)
- [ ] 2.2 Implement `tokensPerTool` computation
- [ ] 2.3 Add `avgToolDurationMs` computation

## 3. Provider Integration

- [ ] 3.1 Define provider metric reporting interface
- [ ] 3.2 Update CLI provider to report duration metrics
- [ ] 3.3 Document metric reporting for custom providers

## 4. Output & Evaluation

- [ ] 4.1 Include metrics in evaluation results JSON
- [ ] 4.2 Make metrics available to code judges via stdin
- [ ] 4.3 Add metrics to JSONL output format

## 5. Examples & Documentation

- [ ] 5.1 Add metrics evaluation example to `examples/features/`
- [ ] 5.2 Create code judge example that uses metrics

## 6. Testing

- [ ] 6.1 Unit tests for metric computation
- [ ] 6.2 Integration test with metric-aware code judge
