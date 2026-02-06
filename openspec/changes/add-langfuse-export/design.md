# Design: Langfuse Export for Observability

## Context

AgentV produces `output_messages` arrays containing tool calls, assistant responses, and timestamps during evaluation runs. This data is valuable for debugging and monitoring but currently stays within AgentV's result files.

Industry frameworks (LangWatch, Mastra, Google ADK, Azure SDK) have adopted OpenTelemetry semantic conventions for LLM observability. Langfuse is an open-source platform that accepts traces in a compatible format.

**Stakeholders:**
- AgentV users who need to debug agent behavior
- Teams integrating AgentV into existing LLMOps workflows
- Developers comparing agent configurations across runs

## Goals / Non-Goals

**Goals:**
- Export `output_messages` to Langfuse as structured traces
- Follow OpenTelemetry GenAI semantic conventions where applicable
- Provide opt-in content capture for privacy-sensitive environments
- Keep export logic decoupled from core evaluation flow

**Non-Goals:**
- Full OpenTelemetry SDK integration (deferred)
- Real-time streaming of traces during execution
- Bi-directional sync with Langfuse (import traces)
- Support for other observability platforms in this change (extensible design only)

## Decisions

### Decision 1: Use Langfuse SDK directly (not OTEL SDK)

**What:** Import `langfuse` npm package and use its native trace/span API.

**Why:**
- Langfuse SDK handles authentication, batching, and flush automatically
- Avoids complexity of OTEL collector setup
- Direct mapping to Langfuse concepts (traces, generations, spans)
- Can add OTEL exporter later as separate capability

**Alternatives considered:**
- Full OTEL SDK + OTLP exporter: More portable but requires collector infrastructure
- Custom HTTP calls: Fragile, no batching, reinvents SDK features

### Decision 2: Map OutputMessage to Langfuse structure

**Mapping:**

| AgentV Concept | Langfuse Concept | Notes |
|----------------|------------------|-------|
| Evaluation run | Trace | One trace per eval case |
| `eval_id` | `trace.name` | Identifies the test case |
| `target` | `trace.metadata.target` | Which provider was used |
| Assistant message with content | Generation | LLM response |
| Tool call | Span (type: "tool") | Individual tool invocation |
| `score` | Score | Attached to trace |

**Langfuse Trace Structure:**
```
Trace: eval_id="case-001"
├── Generation: "assistant response"
│   ├── input: [user messages]
│   ├── output: "response text"
│   └── usage: { input_tokens, output_tokens }
├── Span: tool="search" (type: tool)
│   ├── input: { query: "..." }
│   └── output: "results..."
├── Span: tool="read_file" (type: tool)
│   └── ...
└── Score: name="eval_score", value=0.85
```

### Decision 3: Attribute naming follows GenAI conventions

Use `gen_ai.*` prefixed attributes where applicable:

```typescript
// Generation attributes
'gen_ai.request.model': target.model,
'gen_ai.usage.input_tokens': usage?.input_tokens,
'gen_ai.usage.output_tokens': usage?.output_tokens,

// Tool span attributes
'gen_ai.tool.name': toolCall.tool,
'gen_ai.tool.call.id': toolCall.id,

// Trace metadata
'agentv.eval_id': evalCase.id,
'agentv.target': target.name,
'agentv.dataset': evalCase.dataset,
```

### Decision 4: Privacy-first content capture

**Default:** Do not capture message content or tool inputs/outputs.

**Opt-in:** Set `LANGFUSE_CAPTURE_CONTENT=true` to include:
- User message content
- Assistant response content
- Tool call inputs and outputs

**Rationale:** Traces may contain PII, secrets, or proprietary data. Following Azure SDK and Google ADK patterns of opt-in content capture.

### Decision 5: Flush strategy

**Approach:** Flush traces after each eval case completes (not batched across cases).

**Why:**
- Ensures traces are visible in Langfuse promptly
- Avoids data loss if process crashes
- Trade-off: Slightly higher network overhead (acceptable for eval workloads)

**Configuration:** No user-facing config in v1. Can add `--langfuse-batch` later if needed.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        agentv run                                │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   Provider   │───▶│ Orchestrator │───▶│ EvaluationResult │  │
│  │   Response   │    │              │    │ + outputMessages │  │
│  └──────────────┘    └──────────────┘    └────────┬─────────┘  │
│                                                    │            │
│                           ┌────────────────────────▼──────┐     │
│                           │    LangfuseExporter           │     │
│                           │    (if --langfuse enabled)    │     │
│                           └────────────────┬──────────────┘     │
│                                            │                    │
└────────────────────────────────────────────┼────────────────────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │    Langfuse     │
                                    │    Platform     │
                                    └─────────────────┘
```

## API Surface

### CLI

```bash
# Enable Langfuse export
agentv run eval.yaml --langfuse

# With custom host (self-hosted Langfuse)
LANGFUSE_HOST=https://langfuse.mycompany.com agentv run eval.yaml --langfuse

# With content capture
LANGFUSE_CAPTURE_CONTENT=true agentv run eval.yaml --langfuse
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LANGFUSE_PUBLIC_KEY` | Yes (if --langfuse) | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | Yes (if --langfuse) | Langfuse project secret key |
| `LANGFUSE_HOST` | No | Custom Langfuse host (default: cloud) |
| `LANGFUSE_CAPTURE_CONTENT` | No | Enable content capture (default: false) |

### Programmatic API

```typescript
import { LangfuseExporter } from '@agentv/core/observability';

const exporter = new LangfuseExporter({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  host: process.env.LANGFUSE_HOST,
  captureContent: process.env.LANGFUSE_CAPTURE_CONTENT === 'true',
});

// Export a single result
await exporter.export(evaluationResult, outputMessages);

// Flush pending traces
await exporter.flush();
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Langfuse SDK version churn | Pin to stable version, document upgrade path |
| Network failures during export | Log warning, don't fail evaluation; traces are optional |
| Large traces with many tool calls | Langfuse handles batching internally; monitor payload sizes |
| Content capture leaking secrets | Default to off; document clearly in CLI help |

## Migration Plan

**No migration required.** This is a new optional feature. Existing users are unaffected unless they enable `--langfuse`.

## Open Questions

1. Should we support `--langfuse-session-id` to group multiple eval runs? (Defer to user feedback)
2. Should token usage be estimated if provider doesn't return it? (Defer - not all providers report usage)
3. Should we add a `--dry-run-langfuse` to preview traces without sending? (Nice to have, not v1)
