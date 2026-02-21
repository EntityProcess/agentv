import type { Message } from '../evaluation/providers/types.js';
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
    headers: (env) => ({
      Authorization: `Bearer ${env.BRAINTRUST_API_KEY ?? ''}`,
    }),
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

  constructor(private readonly options: OtelExportOptions) {}

  /** Initialize the OTel SDK. Returns false if OTel packages are not available. */
  async init(): Promise<boolean> {
    try {
      const [sdkTraceNode, otlpHttp, resourcesMod, semconvMod, api] = await Promise.all([
        import('@opentelemetry/sdk-trace-node'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/semantic-conventions'),
        import('@opentelemetry/api'),
      ]);

      const { NodeTracerProvider: Provider, SimpleSpanProcessor } = sdkTraceNode;
      const { OTLPTraceExporter } = otlpHttp;
      const { resourceFromAttributes } = resourcesMod;
      const { ATTR_SERVICE_NAME } = semconvMod;

      const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: this.options.serviceName ?? 'agentv',
      });

      const exporter = new OTLPTraceExporter({
        url: this.options.endpoint,
        headers: this.options.headers,
      });

      this.provider = new Provider({
        resource,
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      this.provider.register();
      this.api = api;
      this.tracer = api.trace.getTracer('agentv', '1.0.0');
      return true;
    } catch {
      return false;
    }
  }

  /** Export a single evaluation result as an OTel trace. */
  exportResult(result: EvaluationResult): void {
    if (!this.tracer || !this.api) return;

    const api = this.api;
    const tracer = this.tracer;
    const captureContent = this.options.captureContent ?? false;

    // Determine timing
    const startHr = toHrTime(result.trace?.startTime ?? result.timestamp);
    const endHr = toHrTime(result.trace?.endTime ?? result.timestamp);

    tracer.startActiveSpan(
      'agentv.eval',
      { startTime: startHr },
      (rootSpan: {
        setAttribute: (...args: unknown[]) => void;
        addEvent: (...args: unknown[]) => void;
        setStatus: (...args: unknown[]) => void;
        end: (...args: unknown[]) => void;
      }) => {
        // Core attributes
        rootSpan.setAttribute('agentv.test_id', result.testId);
        rootSpan.setAttribute('agentv.target', result.target);
        if (result.dataset) rootSpan.setAttribute('agentv.dataset', result.dataset);
        rootSpan.setAttribute('agentv.score', result.score);
        if (captureContent) rootSpan.setAttribute('agentv.answer', result.answer);

        // Trace summary attributes
        if (result.trace) {
          const t = result.trace;
          rootSpan.setAttribute('agentv.trace.event_count', t.eventCount);
          rootSpan.setAttribute('agentv.trace.tool_names', t.toolNames.join(','));
          if (t.durationMs != null) rootSpan.setAttribute('agentv.trace.duration_ms', t.durationMs);
          if (t.costUsd != null) rootSpan.setAttribute('agentv.trace.cost_usd', t.costUsd);
          if (t.llmCallCount != null)
            rootSpan.setAttribute('agentv.trace.llm_call_count', t.llmCallCount);
        }

        // Child spans from output messages (--trace mode)
        if (result.output) {
          const parentCtx = api.trace.setSpan(api.context.active(), rootSpan);

          for (const msg of result.output) {
            this.exportMessage(tracer, api, parentCtx, msg, captureContent);
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
    const spanName = isAssistant ? 'gen_ai.generation' : `gen_ai.message.${msg.role}`;

    const startHr = toHrTime(msg.startTime);
    const endHr = toHrTime(msg.endTime);

    api.context.with(parentCtx, () => {
      tracer.startActiveSpan(
        spanName,
        { startTime: startHr },
        (span: {
          setAttribute: (...args: unknown[]) => void;
          end: (...args: unknown[]) => void;
        }) => {
          if (msg.metadata?.model) {
            span.setAttribute('gen_ai.request.model', String(msg.metadata.model));
          }
          if (msg.durationMs != null) span.setAttribute('gen_ai.duration_ms', msg.durationMs);

          if (captureContent && msg.content != null) {
            span.setAttribute(
              'gen_ai.content',
              typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            );
          }

          // Tool call child spans
          if (msg.toolCalls) {
            const msgCtx = api.trace.setSpan(api.context.active(), span);
            for (const tc of msg.toolCalls) {
              api.context.with(msgCtx, () => {
                tracer.startActiveSpan(
                  'gen_ai.tool',
                  {},
                  (toolSpan: {
                    setAttribute: (...args: unknown[]) => void;
                    end: (...args: unknown[]) => void;
                  }) => {
                    toolSpan.setAttribute('gen_ai.tool.name', tc.tool);
                    if (tc.id) toolSpan.setAttribute('gen_ai.tool.call.id', tc.id);

                    if (captureContent) {
                      if (tc.input != null) {
                        toolSpan.setAttribute(
                          'gen_ai.tool.input',
                          typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
                        );
                      }
                      if (tc.output != null) {
                        toolSpan.setAttribute(
                          'gen_ai.tool.output',
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
// Utilities
// ---------------------------------------------------------------------------

/** Convert an optional ISO timestamp to an HrTime-compatible value (milliseconds). */
function toHrTime(iso?: string): number | undefined {
  if (!iso) return undefined;
  return new Date(iso).getTime();
}
