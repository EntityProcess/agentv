import type {
  ExternalTraceMetadata,
  TraceSessionEvent,
  TraceSessionEventKind,
  TraceSessionResponse,
  TraceSessionScore,
  TraceSessionSource,
  TraceSessionSpan,
  TraceSessionTokenUsage,
} from './types';

export const TRACE_SESSION_SCHEMA_VERSION = 'agentv.dashboard.trace_session.v1' as const;

export interface TraceSessionProjectionOptions {
  runId?: string;
  artifactPath?: string;
}

export interface TraceSpanNode {
  id: string;
  spanId: string;
  parentSpanId?: string | null;
  span: TraceSessionSpan;
  children: TraceSpanNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const compacted = dropUndefined(value);
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function unixNanoToIso(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new Date(Number(BigInt(value) / 1_000_000n)).toISOString();
  } catch {
    return undefined;
  }
}

function durationMsFromNanos(
  start: string | undefined,
  end: string | undefined,
): number | undefined {
  if (!start || !end) {
    return undefined;
  }
  try {
    const startNanos = BigInt(start);
    const endNanos = BigInt(end);
    if (endNanos < startNanos) {
      return undefined;
    }
    return Number(endNanos - startNanos) / 1_000_000;
  } catch {
    return undefined;
  }
}

function numberFromAttributes(
  attributes: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(attributes[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function tokenUsageFromAttributes(
  attributes: Record<string, unknown> | undefined,
): TraceSessionTokenUsage | undefined {
  if (!attributes) {
    return undefined;
  }

  const nested = asRecord(attributes.token_usage);
  const usage = compactRecord({
    input:
      finiteNumber(nested?.input) ??
      numberFromAttributes(attributes, [
        'gen_ai.usage.input_tokens',
        'llm.token_count.prompt',
        'input_tokens',
      ]),
    output:
      finiteNumber(nested?.output) ??
      numberFromAttributes(attributes, [
        'gen_ai.usage.output_tokens',
        'llm.token_count.completion',
        'output_tokens',
      ]),
    reasoning:
      finiteNumber(nested?.reasoning) ??
      numberFromAttributes(attributes, [
        'gen_ai.usage.reasoning.output_tokens',
        'reasoning_tokens',
      ]),
    cached:
      finiteNumber(nested?.cached) ??
      numberFromAttributes(attributes, ['gen_ai.usage.cache_read.input_tokens', 'cached_tokens']),
    total: finiteNumber(nested?.total) ?? numberFromAttributes(attributes, ['total_tokens']),
  });

  return usage as TraceSessionTokenUsage | undefined;
}

function spanStatusFromValue(value: unknown): TraceSessionSpan['status'] {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return compactRecord({
    code:
      stringValue(record.code) ??
      (typeof record.code === 'number' ? String(record.code) : undefined),
    message: stringValue(record.message),
  }) as TraceSessionSpan['status'];
}

function eventKind(
  name: string,
  attributes: Record<string, unknown> | undefined,
): TraceSessionEventKind {
  const lowerName = name.toLowerCase();
  if (
    lowerName.includes('score') ||
    finiteNumber(attributes?.score) !== undefined ||
    finiteNumber(attributes?.['agentv.score']) !== undefined ||
    finiteNumber(attributes?.['agentv.grader.score']) !== undefined
  ) {
    return 'score';
  }
  if (
    lowerName.includes('annotation') ||
    stringValue(attributes?.text) !== undefined ||
    stringValue(attributes?.annotation) !== undefined ||
    stringValue(attributes?.['agentv.annotation.text']) !== undefined
  ) {
    return 'annotation';
  }
  if (lowerName === 'exception') {
    return 'exception';
  }
  return 'event';
}

function scoreFromEvent(attributes: Record<string, unknown> | undefined): number | undefined {
  if (!attributes) {
    return undefined;
  }
  return (
    finiteNumber(attributes.score) ??
    finiteNumber(attributes['agentv.score']) ??
    finiteNumber(attributes['agentv.grader.score'])
  );
}

function textFromEvent(attributes: Record<string, unknown> | undefined): string | undefined {
  if (!attributes) {
    return undefined;
  }
  return (
    stringValue(attributes.text) ??
    stringValue(attributes.annotation) ??
    stringValue(attributes['agentv.annotation.text']) ??
    stringValue(attributes['exception.message'])
  );
}

function passedFromEvent(attributes: Record<string, unknown> | undefined): boolean | undefined {
  if (!attributes) {
    return undefined;
  }
  return boolValue(attributes.passed) ?? boolValue(attributes['agentv.annotation.passed']);
}

function eventId(
  spanId: string,
  index: number,
  attributes: Record<string, unknown> | undefined,
): string {
  return (
    stringValue(attributes?.event_id) ??
    stringValue(attributes?.['agentv.event_id']) ??
    `${spanId}:event:${index}`
  );
}

function projectSpanEvent(
  spanId: string,
  event: unknown,
  index: number,
): TraceSessionEvent | undefined {
  const record = asRecord(event);
  if (!record) {
    return undefined;
  }
  const name = stringValue(record.name);
  if (!name) {
    return undefined;
  }

  const attributes = asRecord(record.attributes);
  return dropUndefined({
    event_id: eventId(spanId, index, attributes),
    span_id: spanId,
    name,
    kind: eventKind(name, attributes),
    time_unix_nano: stringValue(record.time_unix_nano),
    timestamp: unixNanoToIso(stringValue(record.time_unix_nano)),
    score: scoreFromEvent(attributes),
    text: textFromEvent(attributes),
    passed: passedFromEvent(attributes),
    attributes,
  });
}

function projectSpan(span: unknown, index: number): TraceSessionSpan | undefined {
  const record = asRecord(span);
  if (!record) {
    return undefined;
  }

  const spanId = stringValue(record.span_id) ?? `span-${index}`;
  const traceId = stringValue(record.trace_id);
  const parentSpanId = record.parent_span_id === null ? null : stringValue(record.parent_span_id);
  const attributes = asRecord(record.attributes);
  const startTimeUnixNano = stringValue(record.start_time_unix_nano);
  const endTimeUnixNano = stringValue(record.end_time_unix_nano);
  const events = asArray(record.events)
    .map((event, eventIndex) => projectSpanEvent(spanId, event, eventIndex))
    .filter((event): event is TraceSessionEvent => event !== undefined);

  return dropUndefined({
    id: spanId,
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: parentSpanId,
    name: stringValue(record.name) ?? spanId,
    kind: stringValue(record.kind),
    status: spanStatusFromValue(record.status),
    start_time_unix_nano: startTimeUnixNano,
    end_time_unix_nano: endTimeUnixNano,
    start_time: unixNanoToIso(startTimeUnixNano),
    end_time: unixNanoToIso(endTimeUnixNano),
    duration_ms: durationMsFromNanos(startTimeUnixNano, endTimeUnixNano),
    token_usage: tokenUsageFromAttributes(attributes),
    attributes,
    events: events.length > 0 ? events : undefined,
  });
}

function projectScores(scores: unknown): TraceSessionScore[] | undefined {
  const projected: TraceSessionScore[] = [];

  for (const score of asArray(scores)) {
    const record = asRecord(score);
    const name = stringValue(record?.name);
    const value = finiteNumber(record?.score);
    if (!record || !name || value === undefined) {
      continue;
    }
    projected.push(
      dropUndefined({
        name,
        type: stringValue(record.type),
        score: value,
        weight: finiteNumber(record.weight),
        verdict: stringValue(record.verdict),
        source: stringValue(record.source),
        evaluated_at: stringValue(record.evaluated_at),
        target_span_id: stringValue(record.target_span_id),
        evidence: asRecord(record.evidence),
      }) as TraceSessionScore,
    );
  }

  return projected.length > 0 ? projected : undefined;
}

const EXTERNAL_TRACE_KEYS = ['provider', 'project', 'session_id', 'trace_id', 'url'] as const;

function isSecretLikeKey(key: string): boolean {
  return /(api[_-]?key|authorization|bearer|password|secret|token)/i.test(key);
}

function sanitizeUrl(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizeExternalTrace(value: unknown): ExternalTraceMetadata | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const sanitized = compactRecord({
    provider: stringValue(record.provider),
    project: stringValue(record.project),
    session_id: stringValue(record.session_id),
    trace_id: stringValue(record.trace_id),
    url: sanitizeUrl(record.url),
  }) as ExternalTraceMetadata | undefined;

  return sanitized && EXTERNAL_TRACE_KEYS.some((key) => sanitized[key] !== undefined)
    ? sanitized
    : undefined;
}

function externalTraceFromFlatMetadata(
  metadata: Record<string, unknown> | undefined,
): ExternalTraceMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  return sanitizeExternalTrace({
    provider: metadata.external_trace_provider ?? metadata['external_trace.provider'],
    project: metadata.external_trace_project ?? metadata['external_trace.project'],
    session_id: metadata.external_trace_session_id ?? metadata['external_trace.session_id'],
    trace_id: metadata.external_trace_trace_id ?? metadata['external_trace.trace_id'],
    url: metadata.external_trace_url ?? metadata['external_trace.url'],
  });
}

function sanitizeMetadata(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    if (
      key === 'external_trace' ||
      key.startsWith('external_trace_') ||
      key.startsWith('external_trace.') ||
      isSecretLikeKey(key)
    ) {
      return [];
    }
    if (isRecord(entry)) {
      const nested = sanitizeMetadata(entry);
      return nested ? [[key, nested] as const] : [];
    }
    return [[key, entry] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sourceFromEnvelope(
  source: Record<string, unknown> | undefined,
  artifactPath: string | undefined,
): TraceSessionSource | undefined {
  if (!source && !artifactPath) {
    return undefined;
  }
  return compactRecord({
    kind: stringValue(source?.kind),
    path: stringValue(source?.path),
    provider: stringValue(source?.provider),
    format: stringValue(source?.format),
    version: stringValue(source?.version),
    artifact_path: artifactPath,
    metadata: sanitizeMetadata(asRecord(source?.metadata)),
  }) as TraceSessionSource | undefined;
}

function externalTraceFromEnvelope(
  envelope: Record<string, unknown>,
): ExternalTraceMetadata | undefined {
  const source = asRecord(envelope.source);
  const sourceMetadata = asRecord(source?.metadata);
  const trace = asRecord(envelope.trace);
  const rootSpanId = stringValue(trace?.root_span_id);
  const rootSpan = asArray(trace?.spans)
    .map(asRecord)
    .find((span) => stringValue(span?.span_id) === rootSpanId);
  const rootAttributes = asRecord(rootSpan?.attributes);

  return (
    sanitizeExternalTrace(envelope.external_trace) ??
    sanitizeExternalTrace(sourceMetadata?.external_trace) ??
    externalTraceFromFlatMetadata(sourceMetadata) ??
    externalTraceFromFlatMetadata(rootAttributes)
  );
}

export function traceEnvelopeToTraceSessionResponse(
  input: unknown,
  options: TraceSessionProjectionOptions = {},
): TraceSessionResponse {
  const envelope = asRecord(input) ?? {};
  const evaluation = asRecord(envelope.eval);
  const trace = asRecord(envelope.trace);
  const spans = asArray(trace?.spans)
    .map(projectSpan)
    .filter((span): span is TraceSessionSpan => span !== undefined);
  const events = spans.flatMap((span) => span.events ?? []);

  return dropUndefined({
    schema_version: TRACE_SESSION_SCHEMA_VERSION,
    artifact_id: stringValue(envelope.artifact_id),
    created_at: stringValue(envelope.created_at),
    run_id: options.runId ?? stringValue(evaluation?.run_id),
    test_id: stringValue(evaluation?.test_id),
    suite: stringValue(evaluation?.suite),
    target: stringValue(evaluation?.target),
    trace_id: stringValue(trace?.trace_id),
    root_span_id: stringValue(trace?.root_span_id),
    source: sourceFromEnvelope(asRecord(envelope.source), options.artifactPath),
    external_trace: externalTraceFromEnvelope(envelope),
    spans,
    events,
    scores: projectScores(envelope.scores),
  });
}

export function buildTraceSpanTree(spans: readonly TraceSessionSpan[]): TraceSpanNode[] {
  const nodes = new Map<string, TraceSpanNode>();
  const roots: TraceSpanNode[] = [];

  for (const span of spans) {
    nodes.set(span.span_id, {
      id: span.id,
      spanId: span.span_id,
      parentSpanId: span.parent_span_id,
      span,
      children: [],
    });
  }

  for (const node of nodes.values()) {
    const parentId = typeof node.parentSpanId === 'string' ? node.parentSpanId : undefined;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
