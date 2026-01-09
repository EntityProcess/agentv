import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

type JsonObject = Record<string, unknown>;

type Backend = 'confident' | 'langfuse';

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('-')) return undefined;
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseBackend(value: string | undefined): Backend {
  if (!value) return 'confident';
  if (value === 'confident' || value === 'langfuse') return value;
  throw new Error(`Invalid --backend value: ${value}. Expected: confident | langfuse`);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function ensureTracesSuffix(baseOrTracesUrl: string): string {
  const trimmed = trimTrailingSlashes(baseOrTracesUrl);
  if (trimmed.endsWith('/v1/traces')) return trimmed;
  return `${trimmed}/v1/traces`;
}

function toTracesUrl(backend: Backend): string {
  const tracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (tracesEndpoint) return tracesEndpoint;

  if (backend === 'confident') {
    const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'https://otel.confident-ai.com';
    return ensureTracesSuffix(base);
  }

  // Langfuse expects OTLP on /api/public/otel.
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'https://cloud.langfuse.com/api/public/otel';
  return ensureTracesSuffix(base);
}

function parseJsonl(content: string): JsonObject[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const records: JsonObject[] = [];
  for (const line of lines) {
    records.push(JSON.parse(line) as JsonObject);
  }
  return records;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'failed_to_stringify' });
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

function getTraceName(record: JsonObject): string {
  const evalId = asString(record.eval_id) ?? 'unknown_eval_id';
  const dataset = asString(record.dataset);
  return dataset ? `${dataset}/${evalId}` : evalId;
}

function getSpanTimes(record: JsonObject): { startTime: number; endTime: number } {
  const timestamp = asString(record.timestamp);
  const endTimeMs = timestamp ? Date.parse(timestamp) : Date.now();
  const durationMs = asNumber((record.trace_summary as JsonObject | undefined)?.duration_ms);

  const startTimeMs = durationMs && durationMs >= 0 ? endTimeMs - durationMs : endTimeMs;
  return { startTime: startTimeMs, endTime: endTimeMs };
}

function basicAuthHeaderValue(username: string, password: string): string {
  // Both Node and Bun provide Buffer.
  const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

function buildExporterHeaders(backend: Backend): Record<string, string> {
  if (backend === 'confident') {
    const apiKey = requireEnv('CONFIDENT_API_KEY');
    return { 'x-confident-api-key': apiKey };
  }

  const explicitAuth = process.env.LANGFUSE_AUTH_STRING;
  if (explicitAuth) {
    return { Authorization: `Basic ${explicitAuth}` };
  }

  const publicKey = requireEnv('LANGFUSE_PUBLIC_KEY');
  const secretKey = requireEnv('LANGFUSE_SECRET_KEY');
  return { Authorization: basicAuthHeaderValue(publicKey, secretKey) };
}

function buildConfidentMetadata(record: JsonObject): JsonObject {
  // AgentV CLI writes snake_case JSONL records.
  // Keep this payload small and avoid prompts/tool I/O by default.
  return {
    eval_id: record.eval_id,
    dataset: record.dataset,
    conversation_id: record.conversation_id,
    target: record.target,
    score: record.score,
    hits: record.hits,
    misses: record.misses,
    error: record.error,
    trace_summary: record.trace_summary,
  };
}

function buildLangfuseAttributes(record: JsonObject): Record<string, string> {
  const score = asNumber(record.score);
  const hits = asNumber(record.hits);
  const misses = asNumber(record.misses);

  const attrs: Record<string, string> = {
    // Trace-level mapping (Langfuse)
    'langfuse.trace.name': getTraceName(record),

    // Keep metadata queryable by setting explicit metadata keys.
    'langfuse.trace.metadata.eval_id': asString(record.eval_id) ?? 'unknown_eval_id',
  };

  const dataset = asString(record.dataset);
  if (dataset) attrs['langfuse.trace.metadata.dataset'] = dataset;

  const conversationId = asString(record.conversation_id);
  if (conversationId) attrs['langfuse.session.id'] = conversationId;

  const target = asString(record.target);
  if (target) attrs['langfuse.trace.metadata.target'] = target;

  if (score !== undefined) attrs['langfuse.trace.metadata.score'] = String(score);
  if (hits !== undefined) attrs['langfuse.trace.metadata.hits'] = String(hits);
  if (misses !== undefined) attrs['langfuse.trace.metadata.misses'] = String(misses);

  const error = asString(record.error);
  if (error) attrs['langfuse.trace.metadata.error'] = error;

  if (record.trace_summary !== undefined) {
    attrs['langfuse.trace.metadata.trace_summary'] = safeJsonStringify(record.trace_summary);
  }

  return attrs;
}

function buildSpanAttributes(backend: Backend, record: JsonObject): Record<string, string> {
  if (backend === 'langfuse') {
    return buildLangfuseAttributes(record);
  }

  return {
    // Confident trace-level name (shown in their UI)
    'confident.trace.name': getTraceName(record),

    // Minimal classification
    'confident.span.type': 'agent',
    'confident.span.name': 'agentv.eval_case',

    // Keep metadata small and JSON-stringified (Confident parses JSON strings)
    'confident.trace.metadata': safeJsonStringify(buildConfidentMetadata(record)),
  };
}

async function main(): Promise<void> {
  const inPath = getArgValue('--in');
  if (!inPath) {
    // Keep argument handling minimal.
    // Example usage: bun run export --in path/to/results.jsonl
    throw new Error('Missing required flag: --in <path-to-jsonl>');
  }

  const backend = parseBackend(getArgValue('--backend'));
  const tracesUrl = toTracesUrl(backend);
  const headers = buildExporterHeaders(backend);

  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'agentv-jsonl-export';
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
  });

  const provider = new NodeTracerProvider({ resource });
  const exporter = new OTLPTraceExporter({
    url: tracesUrl,
    headers,
  });

  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  try {
    const tracer = trace.getTracer('agentv.jsonl.export');

    const raw = await readFile(inPath, 'utf8');
    const records = parseJsonl(raw);

    for (const record of records) {
      const { startTime, endTime } = getSpanTimes(record);

      const span = tracer.startSpan('agentv.eval_case', {
        startTime,
        attributes: buildSpanAttributes(backend, record),
      });

      span.end(endTime);
    }

    await provider.forceFlush();

    const resolved = path.resolve(inPath);
    console.log(`Exported ${records.length} traces (${backend}) from ${resolved} -> ${tracesUrl}`);
  } finally {
    await provider.shutdown();
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exitCode = 1;
});
