import type { Tracer } from "@opentelemetry/api";

export async function getTracer(): Promise<{
  tracer: Tracer;
  api: typeof import("@opentelemetry/api");
} | null> {
  try {
    const api = await import("@opentelemetry/api");
    const { NodeTracerProvider, SimpleSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-node"
    );
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    const { resourceFromAttributes } = await import(
      "@opentelemetry/resources"
    );
    const { ATTR_SERVICE_NAME } = await import(
      "@opentelemetry/semantic-conventions"
    );

    const endpoint = resolveEndpoint();
    const headers = resolveHeaders();

    if (!endpoint) return null;

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "agentv-trace",
    });

    const exporter = new OTLPTraceExporter({ url: endpoint, headers });
    const provider = new NodeTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    return {
      tracer: api.trace.getTracer("agentv-trace", "1.0.0"),
      api,
    };
  } catch {
    return null;
  }
}

function resolveEndpoint(): string | undefined {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`;
  }

  const backend = process.env.AGENTV_TRACE_BACKEND;
  if (backend === "langfuse") {
    const host = process.env.LANGFUSE_HOST || "https://cloud.langfuse.com";
    return `${host}/api/public/otel/v1/traces`;
  }
  if (backend === "braintrust")
    return "https://api.braintrust.dev/otel/v1/traces";
  if (backend === "jaeger") return "http://localhost:4318/v1/traces";

  return undefined;
}

function resolveHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const backend = process.env.AGENTV_TRACE_BACKEND;

  if (backend === "langfuse") {
    const pub = process.env.LANGFUSE_PUBLIC_KEY ?? "";
    const secret = process.env.LANGFUSE_SECRET_KEY ?? "";
    headers.Authorization = `Basic ${Buffer.from(`${pub}:${secret}`).toString("base64")}`;
  } else if (backend === "braintrust") {
    headers.Authorization = `Bearer ${process.env.BRAINTRUST_API_KEY ?? ""}`;
  }

  // Support generic OTEL_EXPORTER_OTLP_HEADERS
  const envHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (envHeaders) {
    for (const pair of envHeaders.split(",")) {
      const [k, v] = pair.split("=");
      if (k && v) headers[k.trim()] = v.trim();
    }
  }

  return headers;
}

/** Flush all pending spans */
export async function flush(): Promise<void> {
  try {
    const api = await import("@opentelemetry/api");
    const provider = api.trace.getTracerProvider();
    if ("forceFlush" in provider) {
      await (provider as any).forceFlush();
    }
  } catch {
    /* ignore */
  }
}
