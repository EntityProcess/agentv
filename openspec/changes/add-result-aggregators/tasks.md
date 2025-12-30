## 1. Confusion Matrix Aggregator

- [ ] 1.1 Implement confusion-matrix aggregator that parses `hits`/`misses` for predictions
- [ ] 1.2 Compute per-class precision, recall, F1
- [ ] 1.3 Compute macro-averaged metrics and accuracy
- [ ] 1.4 Handle edge cases (unparseable results, division by zero)

## 2. CLI Integration

- [ ] 2.1 Add `--aggregator confusion-matrix` flag to `agentv eval` command
- [ ] 2.2 Run aggregator after evaluation completes
- [ ] 2.3 Display metrics in terminal summary

## 3. Output Integration

- [ ] 3.1 Include aggregator results in output file (JSONL/YAML)

## 4. Testing

- [ ] 4.1 Unit tests for confusion-matrix aggregator
- [ ] 4.2 Integration test with export-screening showcase
