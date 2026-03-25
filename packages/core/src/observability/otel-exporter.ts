import type {
  Message,
  ProviderStreamCallbacks,
  ProviderTokenUsage,
} from '../evaluation/providers/types.js';
import type { EvaluationResult } from '../evaluation/types.js';
import type { OtelBackendPreset, OtelExportOptions } from './types.js';

export type { OtelExportOptions, OtelBackendPreset };

// ---------------------------------------------------------------------------
// Backend presets
// ---------------------------------------------------------------------------

export const OTEL_BACKEND_PRESETS: Record<string, OtelBackendPreset> = {
  langfuse: {
    name: 'langfuse',
    endpoint: process.env.LANGFUSE_HOST
      ? `${process.env.LANGFUSE_HOST}/api/public/otel/v1/traces`
      : 'https://cloud.langfuse.com/api/public/otel/v1/traces',
    headers: (env) => {
      const pub = env.LANGFUSE_PUBLIC_KEY ?? '';
      const secret = env.LANGFUSE_SECRET_KEY ?? '';
      return { Authorization: `Basic ${Buffer.from(`${pub}:${secret}`).toString('base64')}` };
    },
  },
  braintrust: {
    name: 'braintrust',
    endpoint: 'https://api.braintrust.dev/otel/v1/traces',
    headers: (env) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${env.BRAINTRUST_API_KEY ?? ''}`,
      };
      // x-bt-parent is required by Braintrust to associate traces with a project
      const parent =
        env.BRAINTRUST_PARENT ??
        (env.BRAINTRUST_PROJECT_ID ? `project_id:${env.BRAINTRUST_PROJECT_ID}` : undefined) ??
        (env.BRAINTRUST_PROJECT ? `project_name:${env.BRAINTRUST_PROJECT}` : undefined);
      if (parent) {
        headers['x-bt-parent'] = parent;
      }
      return headers;
    },
  },
  confident: {
    name: 'confident',
    endpoint: 'https://otel.confident-ai.com/v1/traces',
    headers: (env) => ({
      'x-confident-api-key': env.CONFIDENT_API_KEY ?? '',
    }),
  },
};

// ---------------------------------------------------------------------------
// OTel type aliases (resolved dynamically at init)
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: OTel types loaded dynamically
type OtelApi = any;
// biome-ignore lint/suspicious/noExplicitAny: OTel types loaded dynamically
type NodeTracerProvider = any;
// biome-ignore lint/suspicious/noExplicitAny: OTel types loaded dynamically
type Tracer = any;

// ---------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------

export class OtelTraceExporter {
  private provider: NodeTracerProvider | null = null;
  private tracer: Tracer | null = null;
  private api: OtelApi | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: OTel types loaded dynamically
  private W3CPropagator: any = null;

  constructor(private readonly options: OtelExportOptions) {}

  /** Initialize the OTel SDK. Returns false if OTel packages are not available. */
  async init(): Promise<boolean> {
    try {
      const [sdkTraceNode, resourcesMod, semconvMod, api, coreMod] = await Promise.all([
        import('@opentelemetry/sdk-trace-node'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/semantic-conventions'),
        import('@opentelemetry/api'),
        import('@opentelemetry/core').catch(() => null),
      ]);

      const { NodeTracerProvider: Provider, SimpleSpanProcessor } = sdkTraceNode;
      const { resourceFromAttributes } = resourcesMod;
      const { ATTR_SERVICE_NAME } = semconvMod;

      const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: this.options.serviceName ?? 'agentv',
      });

      // biome-ignore lint/suspicious/noExplicitAny: OTel processor types loaded dynamically
      const processors: any[] = [];

      // Remote OTLP exporter (only when endpoint is configured)
      if (this.options.endpoint) {
        const otlpHttp = await import('@opentelemetry/exporter-trace-otlp-http');
        const { OTLPTraceExporter } = otlpHttp;
        const exporter = new OTLPTraceExporter({
          url: this.options.endpoint,
          headers: this.options.headers,
        });
        processors.push(new SimpleSpanProcessor(exporter));
      }

      // OTLP JSON file exporter
      if (this.options.otlpFilePath) {
        const { OtlpJsonFileExporter } = await import('./otlp-json-file-exporter.js');
        processors.push(
          new SimpleSpanProcessor(new OtlpJsonFileExporter(this.options.otlpFilePath)),
        );
      }

      if (processors.length === 0) {
        return false;
      }

      this.provider = new Provider({
        resource,
        spanProcessors: processors,
      });
      this.provider.register();
      this.api = api;
      this.tracer = api.trace.getTracer('agentv', '1.0.0');
      this.W3CPropagator = coreMod?.W3CTraceContextPropagator ?? null;
      return true;
    } catch {
      return false;
    }
  }

  /** Export a single evaluation result as an OTel trace. */
  async exportResult(result: EvaluationResult): Promise<void> {
    if (!this.tracer || !this.api) return;

    const api = this.api;
    const tracer = this.tracer;
    const captureContent = this.options.captureContent ?? false;

    // Determine timing
    const startHr = toHrTime(result.startTime ?? result.timestamp);
    const endHr = toHrTime(result.endTime ?? result.timestamp);

    // Support trace composition via W3C traceparent propagation
    let parentCtx = api.ROOT_CONTEXT;
    const traceparent = process.env.TRACEPARENT;
    if (traceparent && this.W3CPropagator) {
      try {
        const propagator = new this.W3CPropagator();
        parentCtx = propagator.extract(
          api.ROOT_CONTEXT,
          { traceparent, tracestate: process.env.TRACESTATE ?? '' },
          {
            get: (carrier: Record<string, string>, key: string) => carrier[key],
            keys: (carrier: Record<string, string>) => Object.keys(carrier),
          },
        );
      } catch {
        // Malformed TRACEPARENT — fall back to standalone trace
      }
    }

    tracer.startActiveSpan(
      'agentv.eval',
      { startTime: startHr },
      parentCtx,
      (rootSpan: {
        setAttribute: (...args: unknown[]) => void;
        addEvent: (...args: unknown[]) => void;
        setStatus: (...args: unknown[]) => void;
        end: (...args: unknown[]) => void;
      }) => {
        // GenAI semantic convention attributes
        rootSpan.setAttribute('gen_ai.operation.name', 'evaluate');
        rootSpan.setAttribute('gen_ai.system', 'agentv');

        // Core attributes
        rootSpan.setAttribute('agentv.test_id', result.testId);
        rootSpan.setAttribute('agentv.target', result.target);
        if (result.eval_set) rootSpan.setAttribute('agentv.eval_set', result.eval_set);
        rootSpan.setAttribute('agentv.score', result.score);
        if (captureContent && result.output.length > 0) {
          const lastMsg = result.output[result.output.length - 1];
          const text =
            typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
          rootSpan.setAttribute('agentv.output_text', text);
        }

        // Flat execution metrics
        if (result.durationMs != null)
          rootSpan.setAttribute('agentv.trace.duration_ms', result.durationMs);
        if (result.costUsd != null) rootSpan.setAttribute('agentv.trace.cost_usd', result.costUsd);
        if (result.tokenUsage) {
          if (result.tokenUsage.input != null) {
            rootSpan.setAttribute('agentv.trace.token_input', result.tokenUsage.input);
          }
          if (result.tokenUsage.output != null) {
            rootSpan.setAttribute('agentv.trace.token_output', result.tokenUsage.output);
          }
          if (result.tokenUsage.cached != null) {
            rootSpan.setAttribute('agentv.trace.token_cached', result.tokenUsage.cached);
          }
        }

        // Trace summary attributes (tool-specific)
        if (result.trace) {
          const t = result.trace;
          rootSpan.setAttribute('agentv.trace.event_count', t.eventCount);
          rootSpan.setAttribute(
            'agentv.trace.tool_names',
            Object.keys(t.toolCalls).sort().join(','),
          );
          if (t.llmCallCount != null)
            rootSpan.setAttribute('agentv.trace.llm_call_count', t.llmCallCount);
        }

        // Child spans from output messages (--trace mode)
        if (result.output) {
          const parentCtx = api.trace.setSpan(api.context.active(), rootSpan);

          if (this.options.groupTurns) {
            const turns = groupMessagesIntoTurns(result.output);
            if (turns.length > 1) {
              for (const [i, turn] of turns.entries()) {
                api.context.with(parentCtx, () => {
                  tracer.startActiveSpan(
                    `agentv.turn.${i + 1}`,
                    {},
                    (turnSpan: {
                      end: (...args: unknown[]) => void;
                    }) => {
                      const turnCtx = api.trace.setSpan(api.context.active(), turnSpan);
                      for (const msg of turn.messages) {
                        this.exportMessage(tracer, api, turnCtx, msg, captureContent);
                      }
                      turnSpan.end();
                    },
                  );
                });
              }
            } else {
              for (const msg of result.output) {
                this.exportMessage(tracer, api, parentCtx, msg, captureContent);
              }
            }
          } else {
            for (const msg of result.output) {
              this.exportMessage(tracer, api, parentCtx, msg, captureContent);
            }
          }
        }

        // Evaluator scores as span events
        if (result.scores) {
          for (const score of result.scores) {
            rootSpan.addEvent(`agentv.evaluator.${score.name}`, {
              'agentv.evaluator.score': score.score,
              'agentv.evaluator.type': score.type,
              ...(score.verdict ? { 'agentv.evaluator.verdict': score.verdict } : {}),
            });
          }
        }

        // Status
        if (result.error) {
          rootSpan.setStatus({ code: api.SpanStatusCode.ERROR, message: result.error });
        } else {
          rootSpan.setStatus({ code: api.SpanStatusCode.OK });
        }

        rootSpan.end(endHr);
      },
    );
  }

  /** Flush pending spans and shut down. */
  async shutdown(): Promise<void> {
    await this.provider?.shutdown();
  }

  /** Create a streaming observer for real-time span export */
  createStreamingObserver(): OtelStreamingObserver | null {
    if (!this.tracer || !this.api) return null;
    // Extract TRACEPARENT for trace composition
    let parentCtx: unknown;
    const traceparent = process.env.TRACEPARENT;
    if (traceparent && this.W3CPropagator) {
      try {
        const propagator = new this.W3CPropagator();
        parentCtx = propagator.extract(
          this.api.ROOT_CONTEXT,
          { traceparent, tracestate: process.env.TRACESTATE ?? '' },
          {
            get: (carrier: Record<string, string>, key: string) => carrier[key],
            keys: (carrier: Record<string, string>) => Object.keys(carrier),
          },
        );
      } catch {
        // Malformed TRACEPARENT — ignore
      }
    }
    return new OtelStreamingObserver(
      this.tracer,
      this.api,
      this.options.captureContent ?? false,
      parentCtx,
    );
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private exportMessage(
    tracer: Tracer,
    api: OtelApi,
    parentCtx: unknown,
    msg: Message,
    captureContent: boolean,
  ): void {
    const isAssistant = msg.role === 'assistant';
    const model = msg.metadata?.model ? String(msg.metadata.model) : undefined;
    const spanName = isAssistant ? `chat ${model ?? 'unknown'}` : `gen_ai.message.${msg.role}`;

    const startHr = toHrTime(msg.startTime);
    const endHr = toHrTime(msg.endTime);

    api.context.with(parentCtx, () => {
      tracer.startActiveSpan(
        spanName,
        { startTime: startHr },
        parentCtx,
        (span: {
          setAttribute: (...args: unknown[]) => void;
          end: (...args: unknown[]) => void;
        }) => {
          if (isAssistant) {
            span.setAttribute('gen_ai.operation.name', 'chat');
          }
          if (model) {
            span.setAttribute('gen_ai.request.model', model);
            span.setAttribute('gen_ai.response.model', model);
          }

          // Per-span token usage (GenAI conventions)
          if (msg.tokenUsage) {
            if (msg.tokenUsage.input != null) {
              span.setAttribute('gen_ai.usage.input_tokens', msg.tokenUsage.input);
            }
            if (msg.tokenUsage.output != null) {
              span.setAttribute('gen_ai.usage.output_tokens', msg.tokenUsage.output);
            }
            if (msg.tokenUsage.cached != null) {
              span.setAttribute('gen_ai.usage.cache_read.input_tokens', msg.tokenUsage.cached);
            }
          }

          if (captureContent && msg.content != null) {
            span.setAttribute(
              'gen_ai.output.messages',
              typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            );
          }

          // Tool call child spans
          if (msg.toolCalls) {
            const msgCtx = api.trace.setSpan(api.context.active(), span);
            for (const tc of msg.toolCalls) {
              api.context.with(msgCtx, () => {
                tracer.startActiveSpan(
                  `execute_tool ${tc.tool}`,
                  {},
                  msgCtx,
                  (toolSpan: {
                    setAttribute: (...args: unknown[]) => void;
                    end: (...args: unknown[]) => void;
                  }) => {
                    toolSpan.setAttribute('gen_ai.tool.name', tc.tool);
                    if (tc.id) toolSpan.setAttribute('gen_ai.tool.call.id', tc.id);

                    if (captureContent) {
                      if (tc.input != null) {
                        toolSpan.setAttribute(
                          'gen_ai.tool.call.arguments',
                          typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
                        );
                      }
                      if (tc.output != null) {
                        toolSpan.setAttribute(
                          'gen_ai.tool.call.result',
                          typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output),
                        );
                      }
                    }

                    toolSpan.end();
                  },
                );
              });
            }
          }

          span.end(endHr);
        },
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Streaming observer
// ---------------------------------------------------------------------------

/**
 * Streaming observer that creates OTel spans in real-time during eval execution.
 * Spans are exported immediately via SimpleSpanProcessor as each tool call / LLM response completes.
 */
export class OtelStreamingObserver {
  // biome-ignore lint/suspicious/noExplicitAny: OTel span type loaded dynamically
  private rootSpan: any = null;
  // biome-ignore lint/suspicious/noExplicitAny: OTel context loaded dynamically
  private rootCtx: any = null;
  private observedChildSpans = false;
  private pendingMetrics: {
    durationMs?: number;
    costUsd?: number;
    tokenUsage?: ProviderTokenUsage;
    trace?: {
      eventCount: number;
      toolCalls: Record<string, number>;
      llmCallCount?: number;
    };
  } | null = null;

  constructor(
    private readonly tracer: Tracer,
    private readonly api: OtelApi,
    private readonly captureContent: boolean,
    // biome-ignore lint/suspicious/noExplicitAny: OTel context loaded dynamically
    private readonly parentCtx?: any,
  ) {}

  /** Create root eval span immediately (visible in backend right away) */
  startEvalCase(testId: string, target: string, evalSet?: string): void {
    this.pendingMetrics = null;
    this.observedChildSpans = false;
    const ctx = this.parentCtx ?? this.api.context.active();
    this.rootSpan = this.tracer.startSpan('agentv.eval', undefined, ctx);
    this.rootSpan.setAttribute('gen_ai.operation.name', 'evaluate');
    this.rootSpan.setAttribute('gen_ai.system', 'agentv');
    this.rootSpan.setAttribute('agentv.test_id', testId);
    this.rootSpan.setAttribute('agentv.target', target);
    if (evalSet) this.rootSpan.setAttribute('agentv.eval_set', evalSet);
    this.rootCtx = this.api.trace.setSpan(this.api.context.active(), this.rootSpan);
  }

  /** Create and immediately export a tool span */
  onToolCall(
    name: string,
    input: unknown,
    output: unknown,
    _durationMs: number,
    toolCallId?: string,
  ): void {
    if (!this.rootCtx) return;
    this.observedChildSpans = true;
    this.api.context.with(this.rootCtx, () => {
      const span = this.tracer.startSpan(`execute_tool ${name}`, undefined, this.rootCtx);
      span.setAttribute('gen_ai.tool.name', name);
      if (toolCallId) span.setAttribute('gen_ai.tool.call.id', toolCallId);
      if (this.captureContent) {
        if (input != null)
          span.setAttribute(
            'gen_ai.tool.call.arguments',
            typeof input === 'string' ? input : JSON.stringify(input),
          );
        if (output != null)
          span.setAttribute(
            'gen_ai.tool.call.result',
            typeof output === 'string' ? output : JSON.stringify(output),
          );
      }
      span.end();
    });
  }

  /** Create and immediately export an LLM span */
  onLlmCall(model: string, tokenUsage?: ProviderTokenUsage): void {
    if (!this.rootCtx) return;
    this.observedChildSpans = true;
    this.api.context.with(this.rootCtx, () => {
      const span = this.tracer.startSpan(`chat ${model}`, undefined, this.rootCtx);
      span.setAttribute('gen_ai.operation.name', 'chat');
      span.setAttribute('gen_ai.request.model', model);
      span.setAttribute('gen_ai.response.model', model);
      if (tokenUsage) {
        if (tokenUsage.input != null)
          span.setAttribute('gen_ai.usage.input_tokens', tokenUsage.input);
        if (tokenUsage.output != null)
          span.setAttribute('gen_ai.usage.output_tokens', tokenUsage.output);
        if (tokenUsage.cached != null)
          span.setAttribute('gen_ai.usage.cache_read.input_tokens', tokenUsage.cached);
      }
      span.end();
    });
  }

  /** Record final execution metrics before the root span is finalized. */
  recordEvalMetrics(result: {
    durationMs?: number;
    costUsd?: number;
    tokenUsage?: ProviderTokenUsage;
    trace?: {
      eventCount: number;
      toolCalls: Record<string, number>;
      llmCallCount?: number;
    };
  }): void {
    this.pendingMetrics = result;
  }

  /** Finalize root span with score/verdict after evaluation completes */
  finalizeEvalCase(score: number, error?: string): void {
    if (!this.rootSpan) return;
    this.rootSpan.setAttribute('agentv.score', score);
    if (this.pendingMetrics?.durationMs != null) {
      this.rootSpan.setAttribute('agentv.trace.duration_ms', this.pendingMetrics.durationMs);
    }
    if (this.pendingMetrics?.costUsd != null) {
      this.rootSpan.setAttribute('agentv.trace.cost_usd', this.pendingMetrics.costUsd);
    }
    if (this.pendingMetrics?.tokenUsage) {
      if (this.pendingMetrics.tokenUsage.input != null) {
        this.rootSpan.setAttribute(
          'agentv.trace.token_input',
          this.pendingMetrics.tokenUsage.input,
        );
      }
      if (this.pendingMetrics.tokenUsage.output != null) {
        this.rootSpan.setAttribute(
          'agentv.trace.token_output',
          this.pendingMetrics.tokenUsage.output,
        );
      }
      if (this.pendingMetrics.tokenUsage.cached != null) {
        this.rootSpan.setAttribute(
          'agentv.trace.token_cached',
          this.pendingMetrics.tokenUsage.cached,
        );
      }
    }
    if (this.pendingMetrics?.trace) {
      this.rootSpan.setAttribute('agentv.trace.event_count', this.pendingMetrics.trace.eventCount);
      this.rootSpan.setAttribute(
        'agentv.trace.tool_names',
        Object.keys(this.pendingMetrics.trace.toolCalls).sort().join(','),
      );
      if (this.pendingMetrics.trace.llmCallCount != null) {
        this.rootSpan.setAttribute(
          'agentv.trace.llm_call_count',
          this.pendingMetrics.trace.llmCallCount,
        );
      }
    }
    if (error) {
      this.rootSpan.setStatus({ code: this.api.SpanStatusCode.ERROR, message: error });
    } else {
      this.rootSpan.setStatus({ code: this.api.SpanStatusCode.OK });
    }
    this.rootSpan.end();
    this.rootSpan = null;
    this.rootCtx = null;
    this.observedChildSpans = false;
    this.pendingMetrics = null;
  }

  /** Backfill child spans from the completed result when the provider emitted no live callbacks. */
  completeFromResult(result: EvaluationResult): void {
    this.recordEvalMetrics({
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      tokenUsage: result.tokenUsage,
      trace: result.trace,
    });

    if (this.observedChildSpans || !this.rootCtx) {
      return;
    }

    const model =
      result.output.find((msg) => msg.role === 'assistant')?.metadata?.model ??
      result.target ??
      'unknown';

    this.onLlmCall(String(model), result.tokenUsage);

    for (const message of result.output) {
      for (const toolCall of message.toolCalls ?? []) {
        this.onToolCall(
          toolCall.tool,
          toolCall.input,
          toolCall.output,
          toolCall.durationMs ?? 0,
          toolCall.id,
        );
      }
    }
  }

  /** Return the active eval span's trace ID and span ID for Braintrust trace bridging */
  getActiveSpanIds(): { parentSpanId: string; rootSpanId: string } | null {
    if (!this.rootSpan) return null;
    try {
      const spanCtx = this.rootSpan.spanContext?.() ?? this.rootSpan._spanContext;
      if (!spanCtx?.traceId || !spanCtx?.spanId) return null;
      return { parentSpanId: spanCtx.spanId, rootSpanId: spanCtx.traceId };
    } catch {
      return null;
    }
  }

  /** Get ProviderStreamCallbacks for passing to providers */
  getStreamCallbacks(): ProviderStreamCallbacks {
    return {
      onToolCallEnd: (name, input, output, durationMs, toolCallId) =>
        this.onToolCall(name, input, output, durationMs, toolCallId),
      onLlmCallEnd: (model, tokenUsage) => this.onLlmCall(model, tokenUsage),
      getActiveSpanIds: () => this.getActiveSpanIds(),
    };
  }
}

// ---------------------------------------------------------------------------
// Turn grouping
// ---------------------------------------------------------------------------

interface Turn {
  messages: Message[];
}

function groupMessagesIntoTurns(messages: readonly Message[]): Turn[] {
  const turns: Turn[] = [];
  let current: Message[] = [];
  for (const msg of messages) {
    if (msg.role === 'user' && current.length > 0) {
      turns.push({ messages: current });
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) turns.push({ messages: current });
  return turns;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Convert an optional ISO timestamp to an HrTime-compatible value (milliseconds). */
function toHrTime(iso?: string): number | undefined {
  if (!iso) return undefined;
  return new Date(iso).getTime();
}
