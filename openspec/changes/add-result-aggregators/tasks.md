## 1. Core Infrastructure

- [ ] 1.1 Define `ResultAggregator` interface in `packages/core/src/aggregators/types.ts`
- [ ] 1.2 Create aggregator registry with `registerAggregator()` and `getAggregator()` functions
- [ ] 1.3 Add `AggregatorOutput` type with `metrics`, `details`, and optional `summary` fields

## 2. Built-in Aggregators

- [ ] 2.1 Refactor current `calculateEvaluationSummary()` into `basic-stats` aggregator
- [ ] 2.2 Implement `pass-rate` aggregator (percentage above threshold)
- [ ] 2.3 Implement `confusion-matrix` aggregator with P/R/F1 per class

## 3. Custom Aggregator Loading

- [ ] 3.1 Add `loadCustomAggregator()` function to load `.ts`/`.js` files
- [ ] 3.2 Validate exported interface matches `ResultAggregator`
- [ ] 3.3 Add error handling for invalid aggregator files

## 4. CLI Integration

- [ ] 4.1 Add `--aggregator <name|path>` flag to `agentv eval` command
- [ ] 4.2 Support multiple aggregators via repeated flags
- [ ] 4.3 Format and display aggregator results after summary

## 5. YAML Configuration

- [ ] 5.1 Add `aggregators` field to eval YAML schema
- [ ] 5.2 Support inline config: `aggregators: [{ name: confusion-matrix, config: {...} }]`
- [ ] 5.3 Merge CLI and YAML aggregator selections

## 6. Output Integration

- [ ] 6.1 Append aggregator results to JSONL output as final record
- [ ] 6.2 Include aggregator results in YAML output
- [ ] 6.3 Format aggregator metrics in terminal summary

## 7. Testing & Documentation

- [ ] 7.1 Unit tests for each built-in aggregator
- [ ] 7.2 Integration test with export-screening showcase
- [ ] 7.3 Update CLI help text
- [ ] 7.4 Add aggregator example to examples/features/
