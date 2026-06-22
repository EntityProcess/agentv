/**
 * Dashboard trace/session wire read model.
 *
 * This module projects already-normalized `agentv.trace.v1` envelopes into the
 * stable snake_case payload consumed by the local Dashboard and served by the
 * CLI Dashboard API. It intentionally does not normalize raw OTLP/provider
 * traces; that stays in the trace normalization pipeline before artifacts reach
 * this projector.
 */

import type { ExternalTraceMetadataWire } from './external-trace.js';

export interface TraceSessionTokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cached?: number;
  total?: number;
}

export interface TraceSessionSpanStatus {
  code?: string;
  message?: string;
}

export type TraceSessionEventKind = 'annotation' | 'exception' | 'event' | 'score';

export interface TraceSessionEvent {
  event_id: string;
  span_id: string;
  name: string;
  kind: TraceSessionEventKind;
  time_unix_nano?: string;
  timestamp?: string;
  score?: number;
  text?: string;
  passed?: boolean;
  attributes?: Record<string, unknown>;
}

export interface TraceSessionSpan {
  id: string;
  trace_id?: string;
  span_id: string;
  parent_span_id?: string | null;
  name: string;
  kind?: string;
  status?: TraceSessionSpanStatus;
  start_time_unix_nano?: string;
  end_time_unix_nano?: string;
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  token_usage?: TraceSessionTokenUsage;
  resource_attributes?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  events?: TraceSessionEvent[];
}

export interface TraceSessionScore {
  name: string;
  type?: string;
  score: number;
  weight?: number;
  verdict?: string;
  source?: string;
  evaluated_at?: string;
  target_span_id?: string;
  evidence?: Record<string, unknown>;
}

export interface TraceSessionSource {
  kind?: string;
  path?: string;
  provider?: string;
  format?: string;
  version?: string;
  artifact_path?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceSessionArtifactLink {
  name: string;
  path: string;
}

export interface TraceSessionSourceRef {
  event_id?: string;
  message_id?: string;
  span_id?: string;
  trace_id?: string;
  raw_kind?: string;
  path?: string;
  line?: number;
  metadata?: Record<string, unknown>;
}

export interface TraceSessionConversionWarning {
  code: string;
  severity?: 'info' | 'warning' | 'error' | string;
  span_id?: string;
  source_ref?: TraceSessionSourceRef;
  message: string;
  details?: Record<string, unknown>;
}

export interface TraceSessionResponse {
  schema_version: 'agentv.dashboard.trace_session.v1';
  artifact_id?: string;
  created_at?: string;
  run_id?: string;
  test_id?: string;
  suite?: string;
  target?: string;
  trace_id?: string;
  root_span_id?: string;
  source?: TraceSessionSource;
  external_trace?: ExternalTraceMetadataWire;
  artifact_links?: TraceSessionArtifactLink[];
  resource_attributes?: Record<string, unknown>;
  conversion_warnings?: TraceSessionConversionWarning[];
  spans: TraceSessionSpan[];
  events: TraceSessionEvent[];
  scores?: TraceSessionScore[];
}

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
  diagnostics?: TraceSpanTreeDiagnostic[];
}

export type TraceSpanTreeDiagnosticCode =
  | 'cycle'
  | 'duplicate_span_id'
  | 'missing_parent'
  | 'missing_span_id'
  | 'self_parent';

export interface TraceSpanTreeDiagnostic {
  code: TraceSpanTreeDiagnosticCode;
  message: string;
  span_id?: string;
  node_id?: string;
  parent_span_id?: string;
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

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
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

function nonEmptyArray<T>(value: readonly T[] | undefined): readonly T[] | undefined {
  return value && value.length > 0 ? value : undefined;
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

function isExternalTraceKey(key: string): boolean {
  return (
    key === 'external_trace' ||
    key.startsWith('external_trace_') ||
    key.startsWith('external_trace.')
  );
}

function isCredentialLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (
    normalized === 'token_usage' ||
    normalized.endsWith('_tokens') ||
    normalized.endsWith('.tokens') ||
    normalized.includes('usage.')
  ) {
    return false;
  }
  return /(^|[._-])(api[._-]?key|authorization|bearer|password|secret|private[._-]?key|access[._-]?token|auth[._-]?token|client[._-]?secret|id[._-]?token|refresh[._-]?token|session[._-]?token|token)($|[._-])/.test(
    normalized,
  );
}

function sanitizeAttributeMap(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    if (isExternalTraceKey(key) || isCredentialLikeKey(key)) {
      return [];
    }
    if (isRecord(entry)) {
      const nested = sanitizeAttributeMap(entry);
      return nested ? [[key, nested] as const] : [];
    }
    return [[key, entry] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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
    numberFromAttributes(attributes ?? {}, [
      'score',
      'agentv.score',
      'agentv.grader.score',
      'gen_ai.evaluation.score.value',
      'openinference.evaluation.score',
    ]) !== undefined
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
    finiteNumber(attributes['agentv.grader.score']) ??
    finiteNumber(attributes['gen_ai.evaluation.score.value']) ??
    finiteNumber(attributes['openinference.evaluation.score'])
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
    stringValue(attributes['gen_ai.evaluation.explanation']) ??
    stringValue(attributes['gen_ai.evaluation.score.label']) ??
    stringValue(attributes['exception.message'])
  );
}

function passedFromEvent(attributes: Record<string, unknown> | undefined): boolean | undefined {
  if (!attributes) {
    return undefined;
  }
  return (
    boolValue(attributes.passed) ??
    boolValue(attributes['agentv.annotation.passed']) ??
    boolValue(attributes['agentv.grader.passed']) ??
    boolValue(attributes['gen_ai.evaluation.passed'])
  );
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
  const safeAttributes = sanitizeAttributeMap(attributes);
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
    attributes: safeAttributes,
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
  const safeAttributes = sanitizeAttributeMap(attributes);
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
    resource_attributes: sanitizeAttributeMap(asRecord(record.resource_attributes)),
    attributes: safeAttributes,
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

const EXTERNAL_TRACE_KEYS = [
  'provider',
  'source',
  'endpoint',
  'profile',
  'project',
  'project_id',
  'session_id',
  'session_node_id',
  'trace_id',
  'trace_node_id',
  'span_id',
  'span_node_id',
  'traceparent',
  'tracestate',
  'ui_url',
  'run_id',
  'test_id',
  'target',
] as const;

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

function sanitizeExternalTrace(value: unknown): ExternalTraceMetadataWire | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const sanitized = compactRecord({
    provider: stringValue(record.provider),
    source: stringValue(record.source),
    endpoint: sanitizeUrl(record.endpoint),
    profile: stringValue(record.profile),
    project: stringValue(record.project),
    project_id: stringValue(record.project_id) ?? stringValue(record.projectId),
    session_id: stringValue(record.session_id) ?? stringValue(record.session),
    session_node_id:
      stringValue(record.session_node_id) ??
      stringValue(record.session_node) ??
      stringValue(record.node_id),
    trace_id: stringValue(record.trace_id) ?? stringValue(record.trace),
    trace_node_id: stringValue(record.trace_node_id) ?? stringValue(record.trace_node),
    span_id: stringValue(record.span_id) ?? stringValue(record.span),
    span_node_id: stringValue(record.span_node_id) ?? stringValue(record.span_node),
    traceparent: stringValue(record.traceparent),
    tracestate: stringValue(record.tracestate),
    ui_url: sanitizeUrl(record.ui_url ?? record.url ?? record.href),
    run_id: stringValue(record.run_id),
    test_id: stringValue(record.test_id),
    target: stringValue(record.target),
  }) as ExternalTraceMetadataWire | undefined;

  return sanitized && EXTERNAL_TRACE_KEYS.some((key) => sanitized[key] !== undefined)
    ? sanitized
    : undefined;
}

function externalTraceFromFlatMetadata(
  metadata: Record<string, unknown> | undefined,
): ExternalTraceMetadataWire | undefined {
  if (!metadata) {
    return undefined;
  }
  return sanitizeExternalTrace({
    provider: metadata.external_trace_provider ?? metadata['external_trace.provider'],
    source: metadata.external_trace_source ?? metadata['external_trace.source'],
    endpoint: metadata.external_trace_endpoint ?? metadata['external_trace.endpoint'],
    profile: metadata.external_trace_profile ?? metadata['external_trace.profile'],
    project: metadata.external_trace_project ?? metadata['external_trace.project'],
    project_id: metadata.external_trace_project_id ?? metadata['external_trace.project_id'],
    session_id:
      metadata.external_trace_session_id ??
      metadata.external_trace_session ??
      metadata['external_trace.session_id'] ??
      metadata['external_trace.session'],
    session_node_id:
      metadata.external_trace_session_node_id ??
      metadata.external_trace_node_id ??
      metadata['external_trace.session_node_id'] ??
      metadata['external_trace.node_id'],
    trace_id:
      metadata.external_trace_trace_id ??
      metadata.external_trace_trace ??
      metadata['external_trace.trace_id'] ??
      metadata['external_trace.trace'],
    trace_node_id:
      metadata.external_trace_trace_node_id ?? metadata['external_trace.trace_node_id'],
    span_id:
      metadata.external_trace_span_id ??
      metadata.external_trace_span ??
      metadata['external_trace.span_id'] ??
      metadata['external_trace.span'],
    span_node_id: metadata.external_trace_span_node_id ?? metadata['external_trace.span_node_id'],
    traceparent: metadata.external_trace_traceparent ?? metadata['external_trace.traceparent'],
    tracestate: metadata.external_trace_tracestate ?? metadata['external_trace.tracestate'],
    ui_url:
      metadata.external_trace_ui_url ??
      metadata.external_trace_url ??
      metadata['external_trace.ui_url'] ??
      metadata['external_trace.url'],
    run_id: metadata.external_trace_run_id ?? metadata['external_trace.run_id'],
    test_id: metadata.external_trace_test_id ?? metadata['external_trace.test_id'],
    target: metadata.external_trace_target ?? metadata['external_trace.target'],
  });
}

function sanitizeMetadataValue(value: unknown): unknown | undefined {
  if (Array.isArray(value)) {
    const sanitized = value
      .map(sanitizeMetadataValue)
      .filter((entry): entry is unknown => entry !== undefined);
    return sanitized.length > 0 ? sanitized : undefined;
  }
  if (isRecord(value)) {
    return sanitizeMetadata(value);
  }
  return value;
}

function sanitizeMetadata(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    if (isExternalTraceKey(key) || isCredentialLikeKey(key)) {
      return [];
    }
    const sanitized = sanitizeMetadataValue(entry);
    return sanitized !== undefined ? [[key, sanitized] as const] : [];
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

function safeArtifactPath(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw || raw.includes('\0')) {
    return undefined;
  }

  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('//')) {
    return undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return undefined;
  }
  if (normalized.split('/').includes('..')) {
    return undefined;
  }
  return normalized;
}

function projectArtifactLinks(artifacts: unknown): TraceSessionArtifactLink[] | undefined {
  const record = asRecord(artifacts);
  if (!record) {
    return undefined;
  }

  const links = Object.entries(record)
    .flatMap(([name, value]) => {
      if (!stringValue(name) || isCredentialLikeKey(name)) {
        return [];
      }
      const artifactPath = safeArtifactPath(value);
      return artifactPath ? [{ name, path: artifactPath }] : [];
    })
    .sort((first, second) => first.name.localeCompare(second.name));

  return links.length > 0 ? links : undefined;
}

function projectSourceRef(value: unknown): TraceSessionSourceRef | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return compactRecord({
    event_id: stringValue(record.event_id),
    message_id: stringValue(record.message_id),
    span_id: stringValue(record.span_id),
    trace_id: stringValue(record.trace_id),
    raw_kind: stringValue(record.raw_kind),
    path: safeArtifactPath(record.path),
    line: finiteInteger(record.line),
    metadata: sanitizeMetadata(asRecord(record.metadata)),
  }) as TraceSessionSourceRef | undefined;
}

function projectConversionWarnings(warnings: unknown): TraceSessionConversionWarning[] | undefined {
  const projected: TraceSessionConversionWarning[] = [];

  for (const warning of asArray(warnings)) {
    const record = asRecord(warning);
    const code = stringValue(record?.code);
    const message = stringValue(record?.message);
    if (!record || !code || !message) {
      continue;
    }
    projected.push(
      dropUndefined({
        code,
        severity: stringValue(record.severity),
        span_id: stringValue(record.span_id),
        source_ref: projectSourceRef(record.source_ref),
        message,
        details: sanitizeMetadata(asRecord(record.details)),
      }) as TraceSessionConversionWarning,
    );
  }

  return projected.length > 0 ? projected : undefined;
}

function externalTraceFromEnvelope(
  envelope: Record<string, unknown>,
): ExternalTraceMetadataWire | undefined {
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
  const traceResource = asRecord(trace?.resource);
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
    artifact_links: projectArtifactLinks(envelope.artifacts),
    resource_attributes: sanitizeAttributeMap(asRecord(traceResource?.attributes)),
    conversion_warnings: projectConversionWarnings(envelope.conversion_warnings),
    spans,
    events,
    scores: projectScores(envelope.scores),
  });
}

export function buildTraceSpanTree(spans: readonly TraceSessionSpan[]): TraceSpanNode[] {
  const nodes: TraceSpanNode[] = [];
  const firstNodeBySpanId = new Map<string, TraceSpanNode>();
  const spanIdCounts = new Map<string, number>();

  spans.forEach((span, index) => {
    const rawSpanId = stringValue(span.span_id);
    const spanId = rawSpanId ?? `missing-span-${index}`;
    const occurrence = (spanIdCounts.get(spanId) ?? 0) + 1;
    spanIdCounts.set(spanId, occurrence);

    const node: TraceSpanNode = {
      id: occurrence === 1 ? spanId : `${spanId}#${occurrence}`,
      spanId,
      parentSpanId: span.parent_span_id,
      span,
      children: [],
      diagnostics: rawSpanId
        ? undefined
        : [
            {
              code: 'missing_span_id',
              message: 'Span was missing span_id and was assigned a stable node id.',
              node_id: spanId,
            },
          ],
    };

    if (occurrence > 1) {
      addNodeDiagnostic(node, {
        code: 'duplicate_span_id',
        message: 'Duplicate span_id was preserved with a collision-free node id.',
        span_id: spanId,
        node_id: node.id,
      });
    }
    if (!firstNodeBySpanId.has(spanId)) {
      firstNodeBySpanId.set(spanId, node);
    }
    nodes.push(node);
  });

  const parentByNodeId = new Map<string, TraceSpanNode>();
  for (const node of nodes) {
    const parentSpanId =
      typeof node.parentSpanId === 'string' && node.parentSpanId.length > 0
        ? node.parentSpanId
        : undefined;
    if (!parentSpanId) {
      continue;
    }
    if (parentSpanId === node.spanId) {
      addNodeDiagnostic(node, {
        code: 'self_parent',
        message: 'Span parent_span_id points to itself; span was promoted to a root.',
        span_id: node.spanId,
        node_id: node.id,
        parent_span_id: parentSpanId,
      });
      continue;
    }
    const parent = firstNodeBySpanId.get(parentSpanId);
    if (!parent) {
      addNodeDiagnostic(node, {
        code: 'missing_parent',
        message: 'Span parent_span_id was not present in this trace; span was promoted to a root.',
        span_id: node.spanId,
        node_id: node.id,
        parent_span_id: parentSpanId,
      });
      continue;
    }
    parentByNodeId.set(node.id, parent);
  }

  const cyclicNodes: TraceSpanNode[] = [];
  for (const node of nodes) {
    if (hasAncestorCycle(node, parentByNodeId)) {
      cyclicNodes.push(node);
    }
  }
  for (const node of cyclicNodes) {
    parentByNodeId.delete(node.id);
    addNodeDiagnostic(node, {
      code: 'cycle',
      message: 'Span parent chain contains a cycle; span was promoted to a root.',
      span_id: node.spanId,
      node_id: node.id,
      parent_span_id: typeof node.parentSpanId === 'string' ? node.parentSpanId : undefined,
    });
  }

  const roots: TraceSpanNode[] = [];
  for (const node of nodes) {
    const parent = parentByNodeId.get(node.id);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortTraceSpanNodes(roots);
  return roots;
}

function addNodeDiagnostic(node: TraceSpanNode, diagnostic: TraceSpanTreeDiagnostic): void {
  node.diagnostics = [...(node.diagnostics ?? []), diagnostic];
}

function hasAncestorCycle(
  node: TraceSpanNode,
  parentByNodeId: ReadonlyMap<string, TraceSpanNode>,
): boolean {
  const seen = new Set<string>();
  let cursor = parentByNodeId.get(node.id);
  while (cursor) {
    if (cursor.id === node.id || seen.has(cursor.id)) {
      return true;
    }
    seen.add(cursor.id);
    cursor = parentByNodeId.get(cursor.id);
  }
  return false;
}

function compareUnixNanoValue(first: string | undefined, second: string | undefined): number {
  if (first === second) {
    return 0;
  }
  if (!first) {
    return 1;
  }
  if (!second) {
    return -1;
  }
  try {
    const firstValue = BigInt(first);
    const secondValue = BigInt(second);
    return firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
  } catch {
    return first.localeCompare(second);
  }
}

function compareTraceSpanNodes(first: TraceSpanNode, second: TraceSpanNode): number {
  const byStart = compareUnixNanoValue(
    first.span.start_time_unix_nano,
    second.span.start_time_unix_nano,
  );
  if (byStart !== 0) {
    return byStart;
  }
  if (first.spanId === second.parentSpanId) {
    return -1;
  }
  if (second.spanId === first.parentSpanId) {
    return 1;
  }
  const bySpanId = first.spanId.localeCompare(second.spanId);
  return bySpanId !== 0 ? bySpanId : first.id.localeCompare(second.id);
}

function sortTraceSpanNodes(nodes: TraceSpanNode[]): void {
  nodes.sort(compareTraceSpanNodes);
  for (const node of nodes) {
    node.children.sort(compareTraceSpanNodes);
    if (node.children.length > 0) {
      sortTraceSpanNodes(node.children);
    }
    node.diagnostics = nonEmptyArray(node.diagnostics) as TraceSpanTreeDiagnostic[] | undefined;
  }
}
