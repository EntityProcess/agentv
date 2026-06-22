/**
 * Safe external trace correlation metadata.
 *
 * AgentV artifacts remain the canonical source for eval results. This shape is
 * only a non-secret pointer to spans that another system already emitted, so
 * artifact writers keep it deliberately small and credential-free.
 */

import { z } from 'zod';
import type { EvaluationResult } from './types.js';

export interface ExternalTraceMetadata {
  readonly provider?: string;
  readonly source?: string;
  readonly endpoint?: string;
  readonly profile?: string;
  readonly project?: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly sessionNodeId?: string;
  readonly traceId?: string;
  readonly traceNodeId?: string;
  readonly spanId?: string;
  readonly spanNodeId?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
  readonly uiUrl?: string;
  readonly runId?: string;
  readonly testId?: string;
  readonly target?: string;
}

export const ExternalTraceMetadataWireSchema = z
  .object({
    provider: z.string().optional(),
    source: z.string().optional(),
    endpoint: z.string().optional(),
    profile: z.string().optional(),
    project: z.string().optional(),
    project_id: z.string().optional(),
    session_id: z.string().optional(),
    session_node_id: z.string().optional(),
    trace_id: z.string().optional(),
    trace_node_id: z.string().optional(),
    span_id: z.string().optional(),
    span_node_id: z.string().optional(),
    traceparent: z.string().optional(),
    tracestate: z.string().optional(),
    ui_url: z.string().optional(),
    run_id: z.string().optional(),
    test_id: z.string().optional(),
    target: z.string().optional(),
  })
  .strict();

export type ExternalTraceMetadataWire = z.infer<typeof ExternalTraceMetadataWireSchema>;

const EXTERNAL_TRACE_KEYS = [
  'provider',
  'source',
  'endpoint',
  'profile',
  'project',
  'projectId',
  'sessionId',
  'sessionNodeId',
  'traceId',
  'traceNodeId',
  'spanId',
  'spanNodeId',
  'traceparent',
  'tracestate',
  'uiUrl',
  'runId',
  'testId',
  'target',
] as const;

const TRACEPARENT_RE = /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i;

type ExternalTraceKey = (typeof EXTERNAL_TRACE_KEYS)[number];

type ExternalTraceInput = Partial<Record<ExternalTraceKey, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isCredentialLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized === 'traceparent' || normalized === 'tracestate') {
    return false;
  }
  return /(^|[._-])(api[._-]?key|authorization|bearer|password|secret|private[._-]?key|access[._-]?token|auth[._-]?token|client[._-]?secret|cookie|id[._-]?token|refresh[._-]?token|session[._-]?token|token)($|[._-])/.test(
    normalized,
  );
}

function sanitizeUrl(value: unknown, options?: { stripOtlpPath?: boolean }): string | undefined {
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
    if (options?.stripOtlpPath) {
      url.pathname = url.pathname
        .replace(/\/v1\/traces\/?$/i, '')
        .replace(/\/v1\/?$/i, '')
        .replace(/\/+$/g, '');
      if (!url.pathname) {
        url.pathname = '/';
      }
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizeTraceparent(value: unknown): string | undefined {
  const raw = stringValue(value);
  return raw && TRACEPARENT_RE.test(raw) ? raw.toLowerCase() : undefined;
}

function traceIdFromTraceparent(traceparent: string | undefined): string | undefined {
  return traceparent?.split('-')[1];
}

function sanitizeTracestate(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => {
      const separator = entry.indexOf('=');
      const key = separator >= 0 ? entry.slice(0, separator) : entry;
      return key.length > 0 && !isCredentialLikeKey(key);
    });
  const sanitized = entries.join(',');
  return sanitized.length > 0 && sanitized.length <= 512 ? sanitized : undefined;
}

function compactExternalTrace(value: ExternalTraceMetadata): ExternalTraceMetadata | undefined {
  const compacted = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as ExternalTraceMetadata;
  return EXTERNAL_TRACE_KEYS.some((key) => compacted[key] !== undefined) ? compacted : undefined;
}

function sanitizeExternalTraceObject(value: ExternalTraceInput): ExternalTraceMetadata | undefined {
  const traceparent = sanitizeTraceparent(value.traceparent);
  return compactExternalTrace({
    provider: stringValue(value.provider),
    source: stringValue(value.source),
    endpoint: sanitizeUrl(value.endpoint, { stripOtlpPath: true }),
    profile: stringValue(value.profile),
    project: stringValue(value.project),
    projectId: stringValue(value.projectId),
    sessionId: stringValue(value.sessionId),
    sessionNodeId: stringValue(value.sessionNodeId),
    traceId: stringValue(value.traceId) ?? traceIdFromTraceparent(traceparent),
    traceNodeId: stringValue(value.traceNodeId),
    spanId: stringValue(value.spanId),
    spanNodeId: stringValue(value.spanNodeId),
    traceparent,
    tracestate: sanitizeTracestate(value.tracestate),
    uiUrl: sanitizeUrl(value.uiUrl),
    runId: stringValue(value.runId),
    testId: stringValue(value.testId),
    target: stringValue(value.target),
  });
}

function externalTraceInputFromRecord(record: Record<string, unknown>): ExternalTraceInput {
  return {
    provider: record.provider,
    source: record.source,
    endpoint: record.endpoint,
    profile: record.profile,
    project: record.project ?? record.project_name,
    projectId: record.project_id ?? record.projectId,
    sessionId: record.session_id ?? record.session ?? record.sessionId,
    sessionNodeId:
      record.session_node_id ?? record.session_node ?? record.node_id ?? record.sessionNodeId,
    traceId: record.trace_id ?? record.trace ?? record.traceId,
    traceNodeId: record.trace_node_id ?? record.trace_node ?? record.traceNodeId,
    spanId: record.span_id ?? record.span ?? record.spanId,
    spanNodeId: record.span_node_id ?? record.span_node ?? record.spanNodeId,
    traceparent: record.traceparent,
    tracestate: record.tracestate,
    uiUrl: record.ui_url ?? record.url ?? record.href ?? record.uiUrl,
    runId: record.run_id ?? record.runId,
    testId: record.test_id ?? record.testId,
    target: record.target,
  };
}

function externalTraceFromFlatRecord(
  record: Record<string, unknown> | undefined,
): ExternalTraceMetadata | undefined {
  if (!record) {
    return undefined;
  }
  return sanitizeExternalTraceObject({
    provider: record.external_trace_provider ?? record['external_trace.provider'],
    source: record.external_trace_source ?? record['external_trace.source'],
    endpoint: record.external_trace_endpoint ?? record['external_trace.endpoint'],
    profile: record.external_trace_profile ?? record['external_trace.profile'],
    project:
      record.external_trace_project ??
      record.external_trace_project_name ??
      record['external_trace.project'] ??
      record['external_trace.project_name'],
    projectId: record.external_trace_project_id ?? record['external_trace.project_id'],
    sessionId:
      record.external_trace_session_id ??
      record.external_trace_session ??
      record['external_trace.session_id'] ??
      record['external_trace.session'],
    sessionNodeId:
      record.external_trace_session_node_id ??
      record.external_trace_node_id ??
      record['external_trace.session_node_id'] ??
      record['external_trace.node_id'],
    traceId:
      record.external_trace_trace_id ??
      record.external_trace_trace ??
      record['external_trace.trace_id'] ??
      record['external_trace.trace'],
    traceNodeId: record.external_trace_trace_node_id ?? record['external_trace.trace_node_id'],
    spanId:
      record.external_trace_span_id ??
      record.external_trace_span ??
      record['external_trace.span_id'] ??
      record['external_trace.span'],
    spanNodeId: record.external_trace_span_node_id ?? record['external_trace.span_node_id'],
    traceparent: record.external_trace_traceparent ?? record['external_trace.traceparent'],
    tracestate: record.external_trace_tracestate ?? record['external_trace.tracestate'],
    uiUrl:
      record.external_trace_ui_url ??
      record.external_trace_url ??
      record['external_trace.ui_url'] ??
      record['external_trace.url'],
    runId: record.external_trace_run_id ?? record['external_trace.run_id'],
    testId: record.external_trace_test_id ?? record['external_trace.test_id'],
    target: record.external_trace_target ?? record['external_trace.target'],
  });
}

export function isExternalTraceMetadataKey(key: string): boolean {
  return (
    key === 'external_trace' ||
    key.startsWith('external_trace_') ||
    key.startsWith('external_trace.')
  );
}

export function omitExternalTraceMetadataKeys(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = Object.entries(value).filter(([key]) => !isExternalTraceMetadataKey(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function sanitizeExternalTraceMetadata(value: unknown): ExternalTraceMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return sanitizeExternalTraceObject(externalTraceInputFromRecord(value));
}

export function externalTraceMetadataFromRecord(
  value: Record<string, unknown> | undefined,
): ExternalTraceMetadata | undefined {
  if (!value) {
    return undefined;
  }
  return sanitizeExternalTraceMetadata(value.external_trace) ?? externalTraceFromFlatRecord(value);
}

function envString(
  env: Readonly<Record<string, string | undefined>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = stringValue(env[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function externalTraceMetadataFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExternalTraceMetadata | undefined {
  const traceparent = envString(env, ['AGENTV_EXTERNAL_TRACE_TRACEPARENT', 'TRACEPARENT']);
  const endpoint = envString(env, [
    'AGENTV_EXTERNAL_TRACE_ENDPOINT',
    'AGENTV_PHOENIX_ENDPOINT',
    'AGENTV_PHOENIX_BASE_URL',
    'PHOENIX_BASE_URL',
    'PHOENIX_ENDPOINT',
    'PHOENIX_HOST',
    'PHOENIX_COLLECTOR_ENDPOINT',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
  ]);
  const project = envString(env, [
    'AGENTV_EXTERNAL_TRACE_PROJECT',
    'AGENTV_EXTERNAL_TRACE_PROJECT_NAME',
    'AGENTV_PHOENIX_PROJECT',
    'AGENTV_PHOENIX_PROJECT_NAME',
    'PHOENIX_PROJECT_NAME',
    'OPENINFERENCE_PROJECT_NAME',
  ]);

  return sanitizeExternalTraceObject({
    provider:
      envString(env, ['AGENTV_EXTERNAL_TRACE_PROVIDER']) ??
      (endpoint || project ? 'phoenix' : undefined),
    source: envString(env, ['AGENTV_EXTERNAL_TRACE_SOURCE']),
    endpoint,
    profile: envString(env, ['AGENTV_EXTERNAL_TRACE_PROFILE', 'AGENTV_PHOENIX_PROFILE']),
    project,
    projectId: envString(env, [
      'AGENTV_EXTERNAL_TRACE_PROJECT_ID',
      'AGENTV_PHOENIX_PROJECT_ID',
      'PHOENIX_PROJECT_ID',
    ]),
    sessionId: envString(env, [
      'AGENTV_EXTERNAL_TRACE_SESSION_ID',
      'PHOENIX_SESSION_ID',
      'ARIZE_SESSION_ID',
      'CODEX_SESSION_ID',
    ]),
    sessionNodeId: envString(env, [
      'AGENTV_EXTERNAL_TRACE_SESSION_NODE_ID',
      'PHOENIX_SESSION_NODE_ID',
    ]),
    traceId: envString(env, [
      'AGENTV_EXTERNAL_TRACE_TRACE_ID',
      'PHOENIX_TRACE_ID',
      'ARIZE_TRACE_ID',
    ]),
    traceNodeId: envString(env, ['AGENTV_EXTERNAL_TRACE_TRACE_NODE_ID', 'PHOENIX_TRACE_NODE_ID']),
    spanId: envString(env, ['AGENTV_EXTERNAL_TRACE_SPAN_ID', 'PHOENIX_SPAN_ID']),
    spanNodeId: envString(env, ['AGENTV_EXTERNAL_TRACE_SPAN_NODE_ID', 'PHOENIX_SPAN_NODE_ID']),
    traceparent,
    tracestate: envString(env, ['AGENTV_EXTERNAL_TRACE_TRACESTATE', 'TRACESTATE']),
    uiUrl: envString(env, ['AGENTV_EXTERNAL_TRACE_UI_URL', 'PHOENIX_UI_URL']),
    runId: envString(env, ['AGENTV_EXTERNAL_TRACE_RUN_ID']),
    testId: envString(env, ['AGENTV_EXTERNAL_TRACE_TEST_ID']),
    target: envString(env, ['AGENTV_EXTERNAL_TRACE_TARGET']),
  });
}

function mergeExternalTraceMetadata(
  values: readonly (ExternalTraceMetadata | undefined)[],
): ExternalTraceMetadata | undefined {
  const merged = Object.assign({}, ...values.filter(Boolean)) as ExternalTraceMetadata;
  return compactExternalTrace(merged);
}

function hasExternalTraceSignal(metadata: ExternalTraceMetadata | undefined): boolean {
  if (!metadata) {
    return false;
  }
  return [
    metadata.endpoint,
    metadata.profile,
    metadata.project,
    metadata.projectId,
    metadata.sessionId,
    metadata.sessionNodeId,
    metadata.traceId,
    metadata.traceNodeId,
    metadata.spanId,
    metadata.spanNodeId,
    metadata.traceparent,
    metadata.tracestate,
    metadata.uiUrl,
    metadata.runId,
  ].some((value) => value !== undefined);
}

export function externalTraceMetadataForResult(
  result: EvaluationResult,
  options: { runId?: string; env?: Readonly<Record<string, string | undefined>> } = {},
): ExternalTraceMetadata | undefined {
  const resultMetadata = externalTraceMetadataFromRecord(result.metadata);
  const traceMetadata = externalTraceMetadataFromRecord(result.trace.metadata);
  const envMetadata = externalTraceMetadataFromEnv(options.env);
  const externalMetadata = mergeExternalTraceMetadata([envMetadata, traceMetadata, resultMetadata]);

  if (!hasExternalTraceSignal(externalMetadata)) {
    return undefined;
  }

  return mergeExternalTraceMetadata([
    externalMetadata,
    sanitizeExternalTraceObject({
      runId: externalMetadata?.runId ?? options.runId,
      testId: result.testId,
      target: result.target,
      source:
        externalMetadata?.source ??
        (typeof result.trace.metadata?.provider === 'string'
          ? result.trace.metadata.provider
          : result.target),
    }),
  ]);
}

export function toExternalTraceMetadataWire(
  metadata: ExternalTraceMetadata,
): ExternalTraceMetadataWire {
  const wire = {
    provider: metadata.provider,
    source: metadata.source,
    endpoint: metadata.endpoint,
    profile: metadata.profile,
    project: metadata.project,
    project_id: metadata.projectId,
    session_id: metadata.sessionId,
    session_node_id: metadata.sessionNodeId,
    trace_id: metadata.traceId,
    trace_node_id: metadata.traceNodeId,
    span_id: metadata.spanId,
    span_node_id: metadata.spanNodeId,
    traceparent: metadata.traceparent,
    tracestate: metadata.tracestate,
    ui_url: metadata.uiUrl,
    run_id: metadata.runId,
    test_id: metadata.testId,
    target: metadata.target,
  };
  return ExternalTraceMetadataWireSchema.parse(
    Object.fromEntries(Object.entries(wire).filter(([, value]) => value !== undefined)),
  );
}

export function fromExternalTraceMetadataWire(
  input: ExternalTraceMetadataWire,
): ExternalTraceMetadata {
  return {
    provider: input.provider,
    source: input.source,
    endpoint: input.endpoint,
    profile: input.profile,
    project: input.project,
    projectId: input.project_id,
    sessionId: input.session_id,
    sessionNodeId: input.session_node_id,
    traceId: input.trace_id,
    traceNodeId: input.trace_node_id,
    spanId: input.span_id,
    spanNodeId: input.span_node_id,
    traceparent: input.traceparent,
    tracestate: input.tracestate,
    uiUrl: input.ui_url,
    runId: input.run_id,
    testId: input.test_id,
    target: input.target,
  };
}
