# Langfuse OTel Export

Demonstrates exporting eval traces to [Langfuse](https://langfuse.com) via OpenTelemetry.

AgentV uses OTLP/HTTP — no Langfuse SDK required. The `langfuse` backend preset handles endpoint and auth automatically.

## Setup

1. Copy `.env.example` to `.env` and fill in your Langfuse credentials:

```bash
cp .env.example .env
```

2. Run evals — traces appear in your Langfuse dashboard automatically:

```bash
agentv eval examples/features/langfuse-export/evals/eval.yaml
```

No `--export-otel` or `--otel-backend` flags needed — the config.yaml handles it.

## How It Works

- `.agentv/config.yaml` declares `export_otel: true` and `otel_backend: langfuse`
- AgentV constructs Basic Auth from `LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY`
- Spans are sent to `https://cloud.langfuse.com/api/public/otel/v1/traces` (or your self-hosted instance via `LANGFUSE_HOST`)
- Uses GenAI semantic conventions (`gen_ai.*`) that Langfuse dashboards recognize

## Self-Hosted Langfuse

Add `LANGFUSE_HOST` to your `.env`:

```bash
LANGFUSE_HOST=https://your-langfuse-instance.com
```

## CLI Override

Config.yaml defaults can always be overridden by CLI flags:

```bash
# Disable OTel export for a single run
agentv eval evals/eval.yaml  # export_otel in config still applies

# Use a different backend
agentv eval evals/eval.yaml --export-otel --otel-backend braintrust
```
