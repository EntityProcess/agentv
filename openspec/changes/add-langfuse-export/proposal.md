# Change: Add Langfuse Export for Observability

## Why

AgentV captures rich execution traces via `output_messages` (tool calls, assistant responses, timestamps) but has no way to export this data to observability platforms. Users need to debug agent behavior, monitor performance, and integrate with existing LLMOps tooling.

Langfuse is an open-source LLM observability platform that supports OpenTelemetry-compatible trace ingestion. By exporting AgentV traces to Langfuse, users can:
- Visualize agent execution flows
- Debug tool call sequences
- Track token usage and latency across evaluations
- Compare agent behavior across different configurations

## What Changes

- **Add `langfuse` export option**: Convert `output_messages` to OpenTelemetry-compatible spans and send to Langfuse
  - New `--langfuse` CLI flag enables export during `agentv run`
  - Supports `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` environment variables
  - Maps `OutputMessage` and `ToolCall` to Langfuse trace/span format
  - Uses `gen_ai.*` semantic conventions for LLM attributes
  - Optional content capture controlled by `LANGFUSE_CAPTURE_CONTENT` (default: false for privacy)

- **Add new `observability` capability spec**: Defines trace export behavior and provider contracts

## Impact

- Affected specs: New `observability` capability (does not modify existing specs)
- Affected code:
  - `packages/core/src/observability/` (new directory)
  - `packages/core/src/observability/langfuse-exporter.ts` (new file)
  - `packages/core/src/observability/types.ts` (new file)
  - `apps/cli/src/index.ts` (add `--langfuse` flag to run command)
  - `packages/core/package.json` (add `langfuse` dependency)
