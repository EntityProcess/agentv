# JSONL → OpenTelemetry export (Confident AI or Langfuse)

This example shows how to take AgentV JSONL results (produced by `agentv eval --output-format jsonl`) and send them to a backend via OpenTelemetry (OTLP over HTTP).

It is intentionally **standalone** and does not modify AgentV core.

## Prerequisites

- Bun
- Either:
	- Confident AI API key, or
	- Langfuse API keys

## Install

From this folder:

```bash
bun install
```

## Configure

This exporter supports `--backend confident` (default) or `--backend langfuse`.

### Confident AI

Set:

- `CONFIDENT_API_KEY` (required)
- `OTEL_EXPORTER_OTLP_ENDPOINT` (optional, defaults to `https://otel.confident-ai.com`)

Example:

```bash
export CONFIDENT_API_KEY="confident_us_..."
export OTEL_EXPORTER_OTLP_ENDPOINT="https://otel.confident-ai.com"
```

Confident expects OTLP/HTTP traces at:

- `https://otel.confident-ai.com/v1/traces`

### Langfuse

Set:

- `LANGFUSE_PUBLIC_KEY` (required)
- `LANGFUSE_SECRET_KEY` (required)
- `OTEL_EXPORTER_OTLP_ENDPOINT` (optional, defaults to `https://cloud.langfuse.com/api/public/otel`)

Example (Langfuse Cloud EU):

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel"
```

Example (Langfuse Cloud US):

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export OTEL_EXPORTER_OTLP_ENDPOINT="https://us.cloud.langfuse.com/api/public/otel"
```

Example (self-hosted Langfuse, v3.22.0+):

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel"
```

Note: Langfuse’s OTLP endpoint is HTTP/protobuf (not gRPC).

## Run

```bash
bun run export --in path/to/results.jsonl
```

Specify a backend:

```bash
bun run export --backend confident --in path/to/results.jsonl
bun run export --backend langfuse --in path/to/results.jsonl
```

You can use the included sample file for a quick smoke test:

```bash
bun run export --in ./sample-results.jsonl
```

What it exports:

- One span per JSONL record (per eval case)
- Safe attributes derived from AgentV results (`eval_id`, `target`, `score`, `trace_summary` counts/metrics)
- Does **not** export prompts, tool inputs/outputs, or assistant text

If you want to include additional data, extend the attribute builders in `export-jsonl-to-otel.ts`.
