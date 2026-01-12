# Tasks: Add Langfuse Export

## 1. Core Implementation

- [ ] 1.1 Create `packages/core/src/observability/` directory structure
- [ ] 1.2 Define `TraceExporter` interface in `types.ts`
- [ ] 1.3 Implement `LangfuseExporter` class with trace/span conversion
- [ ] 1.4 Add `langfuse` dependency to `packages/core/package.json`
- [ ] 1.5 Export observability module from `packages/core/src/index.ts`

## 2. OutputMessage to Langfuse Mapping

- [ ] 2.1 Implement `convertToLangfuseTrace()` function
- [ ] 2.2 Map `OutputMessage` with content to Langfuse Generation
- [ ] 2.3 Map `ToolCall` to Langfuse Span (type: tool)
- [ ] 2.4 Attach evaluation score to trace
- [ ] 2.5 Add `gen_ai.*` semantic convention attributes

## 3. Privacy Controls

- [ ] 3.1 Implement content filtering based on `LANGFUSE_CAPTURE_CONTENT`
- [ ] 3.2 Strip message content when capture disabled
- [ ] 3.3 Strip tool inputs/outputs when capture disabled
- [ ] 3.4 Document privacy behavior in code comments

## 4. CLI Integration

- [ ] 4.1 Add `--langfuse` flag to `run` command in `apps/cli/src/index.ts`
- [ ] 4.2 Validate required environment variables when flag is set
- [ ] 4.3 Initialize `LangfuseExporter` when enabled
- [ ] 4.4 Call exporter after each `EvaluationResult` is produced
- [ ] 4.5 Flush exporter after all eval cases complete

## 5. Error Handling

- [ ] 5.1 Catch and log Langfuse SDK errors without failing evaluation
- [ ] 5.2 Warn on missing credentials when `--langfuse` is used
- [ ] 5.3 Handle network timeouts gracefully

## 6. Testing

- [ ] 6.1 Unit tests for `convertToLangfuseTrace()` mapping
- [ ] 6.2 Unit tests for content filtering logic
- [ ] 6.3 Integration test with mock Langfuse server (optional)
- [ ] 6.4 Add example in `examples/` directory

## 7. Documentation

- [ ] 7.1 Add CLI help text for `--langfuse` flag
- [ ] 7.2 Document environment variables in README or docs
- [ ] 7.3 Add usage example to CLI `--help` output
