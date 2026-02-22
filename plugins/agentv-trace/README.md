# @agentv/trace-plugin

Claude Code session tracing plugin that exports session traces to any OTel-compatible backend.

## What it does

Hooks into Claude Code's lifecycle events (session start/end, user prompts, tool use) and emits OpenTelemetry spans. All spans within a session share a single `traceId` so they appear as one trace.

**Phase 1+2 implementation:**
- **Session spans** — marks session start/end with metadata
- **Turn spans** — one span per user prompt turn
- **Tool spans** — one span per tool invocation

## Prerequisites

- [Bun](https://bun.sh) runtime
- An OTel-compatible backend (Jaeger, Langfuse, Braintrust, or any OTLP endpoint)

## Installation

```bash
# Install dependencies
cd plugins/agentv-trace
bun install

# Symlink into Claude Code plugins directory
ln -s "$(pwd)" ~/.claude/plugins/agentv-trace
```

## Configuration

Set environment variables to configure the tracing backend.

### Option 1: Direct OTLP endpoint

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
```

### Option 2: Backend presets

```bash
# Jaeger (local)
export AGENTV_TRACE_BACKEND=jaeger

# Langfuse
export AGENTV_TRACE_BACKEND=langfuse
export LANGFUSE_PUBLIC_KEY=pk-...
export LANGFUSE_SECRET_KEY=sk-...
# Optional: export LANGFUSE_HOST=https://cloud.langfuse.com

# Braintrust
export AGENTV_TRACE_BACKEND=braintrust
export BRAINTRUST_API_KEY=...
```

### Option 3: Generic OTLP headers

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://your-backend/v1"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer token,X-Custom=value"
```

## Usage

Once installed and configured, the plugin automatically traces all Claude Code sessions. No code changes required — hooks are registered via `hooks.json`.

## Verifying it works

### Jaeger (local)

```bash
# Start Jaeger
docker run -d --name jaeger \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/jaeger:latest

# Set backend
export AGENTV_TRACE_BACKEND=jaeger

# Run a Claude Code session, then open http://localhost:16686
# Look for service "agentv-trace"
```

### Langfuse

Set the Langfuse env vars, run a session, then check your Langfuse dashboard for traces under the "agentv-trace" service.

## Architecture

Each hook runs in a separate process. State (trace IDs, span IDs, counters) is persisted to `~/.agentv/trace-state/{session_id}.json` between hook invocations. Atomic writes (temp file + rename) prevent corruption.

Due to process isolation, spans are self-contained — each is started and ended within a single hook process. Parent-child relationships are established via `setSpanContext()` using stored trace/span IDs.
