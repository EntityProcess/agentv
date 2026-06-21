import type { ExternalTraceMetadata, ExternalTraceMetadataWire } from '@agentv/core';

const RESPONSE_SCHEMA_VERSION = 'agentv.dashboard.phoenix_session.v1';
const DEFAULT_PAGE_LIMIT = 1000;
const REDACTED_VALUE = '[redacted]';

export type PhoenixReadStatus =
  | 'ok'
  | 'missing_external_trace'
  | 'not_configured'
  | 'unresolved'
  | 'unreachable'
  | 'schema_mismatch';

export interface PhoenixTokenUsage {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cached?: number;
  readonly total?: number;
}

export interface PhoenixAnnotation {
  readonly id?: string;
  readonly name?: string;
  readonly annotator_kind?: string;
  readonly label?: string;
  readonly score?: number;
  readonly explanation?: string;
  readonly target?: 'session' | 'trace' | 'span';
  readonly target_id?: string;
  readonly result?: unknown;
}

export interface PhoenixSpanDetail {
  readonly span_id: string;
  readonly trace_id?: string;
  readonly parent_span_id?: string;
  readonly name?: string;
  readonly span_kind?: string;
  readonly status?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration_ms?: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly token_usage?: PhoenixTokenUsage;
  readonly cost_usd?: number;
  readonly attributes?: Record<string, unknown>;
  readonly annotations?: readonly PhoenixAnnotation[];
}

export interface PhoenixTraceTreeNode extends PhoenixSpanDetail {
  readonly depth: number;
  readonly child_count: number;
}

export interface PhoenixSessionTurn {
  readonly index: number;
  readonly trace_id?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration_ms?: number;
  readonly status?: string;
  readonly root_span_id?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly token_usage?: PhoenixTokenUsage;
  readonly cost_usd?: number;
  readonly annotations?: readonly PhoenixAnnotation[];
}

export interface PhoenixSessionSummary {
  readonly id?: string;
  readonly session_id?: string;
  readonly project_id?: string;
  readonly project?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration_ms?: number;
  readonly trace_count: number;
  readonly token_usage?: PhoenixTokenUsage;
  readonly cost_usd?: number;
  readonly annotations?: readonly PhoenixAnnotation[];
}

export interface PhoenixLinkedSessionResponse {
  readonly schema_version: typeof RESPONSE_SCHEMA_VERSION;
  readonly status: PhoenixReadStatus;
  readonly message?: string;
  readonly external_trace?: ExternalTraceMetadataWire;
  readonly open_in_phoenix_url?: string;
  readonly session?: PhoenixSessionSummary;
  readonly turns?: readonly PhoenixSessionTurn[];
  readonly spans?: readonly PhoenixSpanDetail[];
  readonly trace_tree?: readonly PhoenixTraceTreeNode[];
  readonly annotations?: readonly PhoenixAnnotation[];
}

interface PhoenixConfig {
  readonly baseUrl: string;
  readonly graphqlUrl: string;
  readonly project?: string;
  readonly headers: Record<string, string>;
}

interface ReadPhoenixLinkedSessionOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
}

interface PhoenixRestSession {
  readonly id?: string;
  readonly sessionId?: string;
  readonly projectId?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly traces: readonly PhoenixRestTrace[];
  readonly raw?: Record<string, unknown>;
}

interface PhoenixRestTrace {
  readonly traceId?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly raw?: Record<string, unknown>;
}

class PhoenixReadError extends Error {
  constructor(
    readonly code: Exclude<PhoenixReadStatus, 'ok' | 'missing_external_trace'>,
    message: string,
  ) {
    super(message);
    this.name = 'PhoenixReadError';
  }
}

const PHOENIX_LINKED_SESSION_GRAPHQL_FIELDS = `
  fragment AgentVPhoenixSpanFields on Span {
    id
    spanId
    parentId
    name
    spanKind
    statusCode: propagatedStatusCode
    startTime
    endTime
    latencyMs
    input {
      value
      truncatedValue
      mimeType
    }
    output {
      value
      truncatedValue
      mimeType
    }
    attributes
    tokenCountTotal
    tokenCountPrompt
    tokenCountCompletion
    cumulativeTokenCountTotal
    cumulativeTokenCountPrompt
    cumulativeTokenCountCompletion
    costSummary {
      prompt {
        cost
        tokens
      }
      completion {
        cost
        tokens
      }
      total {
        cost
        tokens
      }
    }
    spanAnnotations {
      id
      name
      annotatorKind
      label
      score
      explanation
      metadata
      identifier
      spanId
      createdAt
      updatedAt
    }
    trace {
      id
      traceId
      costSummary {
        total {
          cost
          tokens
        }
      }
    }
    project {
      id
      name
    }
  }

  fragment AgentVPhoenixTraceFields on Trace {
    id
    traceId
    startTime
    endTime
    latencyMs
    projectId
    project {
      id
      name
    }
    projectSessionId
    costSummary {
      total {
        cost
        tokens
      }
    }
    traceAnnotations {
      id
      name
      annotatorKind
      label
      score
      explanation
      metadata
      identifier
      createdAt
      updatedAt
    }
    rootSpan {
      ...AgentVPhoenixSpanFields
    }
    spans(first: $spanFirst) {
      edges {
        node {
          ...AgentVPhoenixSpanFields
        }
      }
    }
  }

  fragment AgentVPhoenixSessionFields on ProjectSession {
    id
    sessionId
    startTime
    endTime
    project {
      id
      name
    }
    numTraces
    tokenUsage {
      prompt
      completion
      total
    }
    costSummary {
      prompt {
        cost
        tokens
      }
      completion {
        cost
        tokens
      }
      total {
        cost
        tokens
      }
    }
    sessionAnnotations {
      id
      name
      annotatorKind
      label
      score
      explanation
      metadata
      identifier
      projectSessionId
      createdAt
      updatedAt
    }
    traces(first: $traceFirst) {
      edges {
        node {
          ...AgentVPhoenixTraceFields
        }
      }
    }
  }
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function scrubCredentialFields(value: unknown, depth = 0): unknown {
  if (depth > 20) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubCredentialFields(entry, depth + 1));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isCredentialLikeKey(key) ? REDACTED_VALUE : scrubCredentialFields(entry, depth + 1),
    ]),
  );
}

function scrubCredentialRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const scrubbed = scrubCredentialFields(value);
  return isRecord(scrubbed) ? scrubbed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = finiteNumber(value);
    if (numberValue !== undefined) {
      return numberValue;
    }
  }
  return undefined;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function durationMs(
  startTime: string | undefined,
  endTime: string | undefined,
): number | undefined {
  if (!startTime || !endTime) {
    return undefined;
  }
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return undefined;
  }
  return Math.max(0, end - start);
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname
      .replace(/\/graphql\/?$/i, '')
      .replace(/\/v1\/traces\/?$/i, '')
      .replace(/\/v1\/?$/i, '')
      .replace(/\/+$/g, '');
    if (!url.pathname) {
      url.pathname = '/';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function normalizeGraphqlUrl(value: string | undefined): string | undefined {
  const baseUrl = normalizeBaseUrl(value);
  return baseUrl ? `${baseUrl}/graphql` : undefined;
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

function parseHeaderEntries(value: string | undefined): Record<string, string> {
  const raw = stringValue(value);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([name, headerValue]) => {
          const normalizedName = stringValue(name);
          const normalizedValue = stringValue(headerValue);
          return normalizedName && normalizedValue ? [[normalizedName, normalizedValue]] : [];
        }),
      );
    }
  } catch {
    // Fall through to the PHOENIX_CLIENT_HEADERS comma-separated form.
  }

  const headers: Record<string, string> = {};
  for (const segment of raw.split(',')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = decodeURIComponent(segment.slice(0, separator).trim());
    const headerValue = decodeURIComponent(segment.slice(separator + 1).trim());
    if (name && headerValue) {
      headers[name] = headerValue;
    }
  }
  return headers;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === normalized);
}

function resolvePhoenixConfig(
  externalTrace: ExternalTraceMetadata,
  env: Readonly<Record<string, string | undefined>>,
): PhoenixConfig | undefined {
  const baseUrl = normalizeBaseUrl(
    envString(env, [
      'AGENTV_PHOENIX_ENDPOINT',
      'AGENTV_PHOENIX_BASE_URL',
      'AGENTV_PHOENIX_HOST',
      'PHOENIX_HOST',
      'PHOENIX_BASE_URL',
      'PHOENIX_ENDPOINT',
      'PHOENIX_COLLECTOR_ENDPOINT',
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    ]),
  );
  const graphqlUrl =
    normalizeGraphqlUrl(envString(env, ['AGENTV_PHOENIX_GRAPHQL_URL', 'PHOENIX_GRAPHQL_URL'])) ??
    normalizeGraphqlUrl(baseUrl);

  if (!baseUrl || !graphqlUrl) {
    return undefined;
  }

  const headers = {
    ...parseHeaderEntries(envString(env, ['AGENTV_PHOENIX_HEADERS', 'PHOENIX_CLIENT_HEADERS'])),
  };
  const authorization = envString(env, ['AGENTV_PHOENIX_AUTHORIZATION', 'PHOENIX_AUTHORIZATION']);
  const apiKey = envString(env, ['AGENTV_PHOENIX_API_KEY', 'PHOENIX_API_KEY']);
  const cookie = envString(env, ['AGENTV_PHOENIX_COOKIE', 'PHOENIX_COOKIE']);
  if (authorization && !hasHeader(headers, 'authorization')) {
    headers.Authorization = authorization;
  }
  if (apiKey && !hasHeader(headers, 'authorization')) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (cookie && !hasHeader(headers, 'cookie')) {
    headers.Cookie = cookie;
  }

  return {
    baseUrl,
    graphqlUrl,
    project:
      externalTrace.projectId ??
      externalTrace.project ??
      envString(env, [
        'AGENTV_PHOENIX_PROJECT_ID',
        'AGENTV_PHOENIX_PROJECT',
        'AGENTV_PHOENIX_PROJECT_NAME',
        'PHOENIX_PROJECT',
        'PHOENIX_PROJECT_ID',
        'PHOENIX_PROJECT_NAME',
        'OPENINFERENCE_PROJECT_NAME',
      ]),
    headers,
  };
}

function response(
  status: PhoenixReadStatus,
  message: string,
  externalTrace: ExternalTraceMetadataWire | undefined,
  details: Omit<PhoenixLinkedSessionResponse, 'schema_version' | 'status' | 'message'> = {},
): PhoenixLinkedSessionResponse {
  return {
    schema_version: RESPONSE_SCHEMA_VERSION,
    status,
    message,
    ...(externalTrace && { external_trace: externalTrace }),
    ...details,
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '%252F');
}

function appendQuery(url: URL, key: string, value: string | readonly string[] | undefined): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      url.searchParams.append(key, entry);
    }
    return;
  }
  if (typeof value === 'string') {
    url.searchParams.set(key, value);
  }
}

async function fetchJson(
  requestUrl: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let responseValue: Response;
  try {
    responseValue = await fetchImpl(requestUrl, init);
  } catch (error) {
    throw new PhoenixReadError(
      'unreachable',
      `Phoenix request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (responseValue.status === 404) {
    throw new PhoenixReadError('unresolved', 'No matching Phoenix session or trace was found.');
  }
  if (!responseValue.ok) {
    throw new PhoenixReadError(
      responseValue.status >= 500 ? 'unreachable' : 'schema_mismatch',
      `Phoenix returned HTTP ${responseValue.status}.`,
    );
  }

  try {
    return await responseValue.json();
  } catch {
    throw new PhoenixReadError('schema_mismatch', 'Phoenix returned a non-JSON response.');
  }
}

async function phoenixRestGet(
  config: PhoenixConfig,
  pathName: string,
  query: Record<string, string | readonly string[] | undefined>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const url = new URL(
    pathName,
    config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`,
  );
  for (const [key, value] of Object.entries(query)) {
    appendQuery(url, key, value);
  }
  return fetchJson(
    url.toString(),
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...config.headers,
      },
    },
    fetchImpl,
  );
}

async function phoenixGraphql(
  config: PhoenixConfig,
  body: { query: string; variables: Record<string, unknown> },
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const payload = await fetchJson(
    config.graphqlUrl,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify(body),
    },
    fetchImpl,
  );
  const record = isRecord(payload) ? payload : {};
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    throw new PhoenixReadError('schema_mismatch', 'Phoenix GraphQL returned schema errors.');
  }
  return record.data;
}

function normalizeTrace(raw: unknown): PhoenixRestTrace | undefined {
  const record = isRecord(raw) ? raw : undefined;
  if (!record) {
    return undefined;
  }
  const traceId = stringValue(record.trace_id) ?? stringValue(record.traceId);
  if (!traceId) {
    return undefined;
  }
  return {
    traceId,
    startTime: stringValue(record.start_time) ?? stringValue(record.startTime),
    endTime: stringValue(record.end_time) ?? stringValue(record.endTime),
    raw: record,
  };
}

function normalizeSession(raw: unknown): PhoenixRestSession | undefined {
  const record = isRecord(raw) ? raw : undefined;
  if (!record) {
    return undefined;
  }
  const data = isRecord(record.data) ? record.data : record;
  const traces = asArray(data.traces)
    .map(normalizeTrace)
    .filter((trace): trace is PhoenixRestTrace => trace !== undefined);
  const sessionId =
    stringValue(data.session_id) ?? stringValue(data.sessionId) ?? stringValue(data.id);
  if (!sessionId && traces.length === 0) {
    return undefined;
  }
  return {
    id: stringValue(data.id),
    sessionId,
    projectId: stringValue(data.project_id) ?? stringValue(data.projectId),
    startTime: stringValue(data.start_time) ?? stringValue(data.startTime),
    endTime: stringValue(data.end_time) ?? stringValue(data.endTime),
    traces,
    raw: data,
  };
}

function normalizeGraphqlSession(raw: unknown): PhoenixRestSession | undefined {
  const node = sessionNodeFromGraphqlData(raw);
  if (!node) {
    return undefined;
  }

  const traceNodes = connectionNodes(node.traces)
    .map(normalizeTrace)
    .filter((trace): trace is PhoenixRestTrace => trace !== undefined);
  const sessionId =
    stringValue(node.session_id) ?? stringValue(node.sessionId) ?? stringValue(node.id);
  if (!sessionId && traceNodes.length === 0) {
    return undefined;
  }

  return {
    id: stringValue(node.id),
    sessionId,
    projectId: projectIdFromGraphqlNode(node),
    startTime: stringValue(node.start_time) ?? stringValue(node.startTime),
    endTime: stringValue(node.end_time) ?? stringValue(node.endTime),
    traces: traceNodes,
    raw: node,
  };
}

async function fetchSessionByNodeId(
  config: PhoenixConfig,
  sessionNodeId: string,
  fetchImpl: typeof fetch,
): Promise<PhoenixRestSession | undefined> {
  const data = await phoenixGraphql(
    config,
    {
      query: `
        query AgentVPhoenixLinkedSessionByNode($id: ID!, $traceFirst: Int!, $spanFirst: Int!) {
          node(id: $id) {
            __typename
            ... on ProjectSession {
              ...AgentVPhoenixSessionFields
            }
          }
        }
        ${PHOENIX_LINKED_SESSION_GRAPHQL_FIELDS}
      `,
      variables: { id: sessionNodeId, traceFirst: 100, spanFirst: DEFAULT_PAGE_LIMIT },
    },
    fetchImpl,
  );
  return normalizeGraphqlSession(data);
}

async function fetchSessionByIdGraphql(
  config: PhoenixConfig,
  projectIdentifier: string,
  sessionId: string,
  fetchImpl: typeof fetch,
): Promise<PhoenixRestSession | undefined> {
  const data = await phoenixGraphql(
    config,
    {
      query: `
        query AgentVPhoenixLinkedSessionBySessionId(
          $projectId: ID!
          $sessionId: String!
          $traceFirst: Int!
          $spanFirst: Int!
        ) {
          project: node(id: $projectId) {
            __typename
            ... on Project {
              sessions(first: 1, sessionId: $sessionId) {
                edges {
                  node {
                    ...AgentVPhoenixSessionFields
                  }
                }
              }
            }
          }
        }
        ${PHOENIX_LINKED_SESSION_GRAPHQL_FIELDS}
      `,
      variables: {
        projectId: projectIdentifier,
        sessionId,
        traceFirst: 100,
        spanFirst: DEFAULT_PAGE_LIMIT,
      },
    },
    fetchImpl,
  );
  return normalizeGraphqlSession(data);
}

async function fetchSessionByTraceIdGraphql(
  config: PhoenixConfig,
  projectIdentifier: string,
  traceId: string,
  fetchImpl: typeof fetch,
): Promise<PhoenixRestSession | undefined> {
  const data = await phoenixGraphql(
    config,
    {
      query: `
        query AgentVPhoenixLinkedSessionByTraceId(
          $projectId: ID!
          $traceId: ID!
          $traceFirst: Int!
          $spanFirst: Int!
        ) {
          project: node(id: $projectId) {
            __typename
            ... on Project {
              trace(traceId: $traceId) {
                session {
                  ...AgentVPhoenixSessionFields
                }
              }
            }
          }
        }
        ${PHOENIX_LINKED_SESSION_GRAPHQL_FIELDS}
      `,
      variables: {
        projectId: projectIdentifier,
        traceId,
        traceFirst: 100,
        spanFirst: DEFAULT_PAGE_LIMIT,
      },
    },
    fetchImpl,
  );
  return normalizeGraphqlSession(data);
}

async function fetchSessionByIdRest(
  config: PhoenixConfig,
  sessionId: string,
  fetchImpl: typeof fetch,
): Promise<PhoenixRestSession | undefined> {
  return normalizeSession(
    await phoenixRestGet(config, `v1/sessions/${encodePathSegment(sessionId)}`, {}, fetchImpl),
  );
}

function extractRecords(payload: unknown): Record<string, unknown>[] {
  const record = isRecord(payload) ? payload : {};
  const data = isRecord(record.data) ? record.data.data : record.data;
  return asArray(data)
    .map((entry) => (isRecord(entry) ? entry : undefined))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
}

function connectionNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => isRecord(entry));
  }
  const record = isRecord(value) ? value : undefined;
  return asArray(record?.edges)
    .map((edge) => (isRecord(edge) && isRecord(edge.node) ? edge.node : edge))
    .filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

function projectIdFromGraphqlNode(node: Record<string, unknown>): string | undefined {
  const project = isRecord(node.project) ? node.project : undefined;
  return stringValue(node.projectId) ?? stringValue(project?.id);
}

function sessionNodeFromGraphqlData(raw: unknown): Record<string, unknown> | undefined {
  const data = isRecord(raw) ? raw : undefined;
  if (!data) {
    return undefined;
  }
  if (isRecord(data.node) && stringValue(data.node.sessionId)) {
    return data.node;
  }
  if (isRecord(data.projectSession)) {
    return data.projectSession;
  }
  const project = isRecord(data.project) ? data.project : undefined;
  const sessionFromProject = connectionNodes(project?.sessions)[0];
  if (sessionFromProject) {
    return sessionFromProject;
  }
  const trace = isRecord(project?.trace) ? project.trace : undefined;
  return isRecord(trace?.session) ? trace.session : undefined;
}

async function fetchTraceSpans(
  config: PhoenixConfig,
  projectIdentifier: string,
  traceId: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>[]> {
  return extractRecords(
    await phoenixRestGet(
      config,
      `v1/projects/${encodePathSegment(projectIdentifier)}/spans`,
      { limit: String(DEFAULT_PAGE_LIMIT), trace_id: traceId },
      fetchImpl,
    ),
  );
}

async function fetchAnnotations(
  config: PhoenixConfig,
  projectIdentifier: string,
  kind: 'session' | 'trace' | 'span',
  ids: readonly string[],
  fetchImpl: typeof fetch,
): Promise<PhoenixAnnotation[]> {
  if (ids.length === 0) {
    return [];
  }
  const queryKey = kind === 'session' ? 'session_ids' : kind === 'trace' ? 'trace_ids' : 'span_ids';
  const pathName = `v1/projects/${encodePathSegment(projectIdentifier)}/${kind}_annotations`;
  try {
    return extractRecords(
      await phoenixRestGet(
        config,
        pathName,
        { [queryKey]: ids, limit: String(DEFAULT_PAGE_LIMIT) },
        fetchImpl,
      ),
    ).map((annotation) => normalizeAnnotation(annotation, kind));
  } catch (error) {
    if (error instanceof PhoenixReadError && error.code === 'unresolved') {
      return [];
    }
    throw error;
  }
}

function normalizeAnnotation(
  annotation: Record<string, unknown>,
  target: 'session' | 'trace' | 'span',
  targetId?: string,
): PhoenixAnnotation {
  const result = isRecord(annotation.result) ? annotation.result : undefined;
  return {
    id: stringValue(annotation.id),
    name: stringValue(annotation.name),
    annotator_kind: stringValue(annotation.annotator_kind) ?? stringValue(annotation.annotatorKind),
    label: stringValue(annotation.label) ?? stringValue(result?.label),
    score: finiteNumber(annotation.score) ?? finiteNumber(result?.score),
    explanation: stringValue(annotation.explanation) ?? stringValue(result?.explanation),
    target,
    target_id:
      stringValue(annotation.session_id) ??
      stringValue(annotation.projectSessionId) ??
      stringValue(annotation.trace_id) ??
      stringValue(annotation.span_id) ??
      stringValue(annotation.spanId) ??
      targetId,
    result: scrubCredentialFields(annotation.result ?? annotation.metadata),
  };
}

function spanContext(span: Record<string, unknown>): Record<string, unknown> {
  return isRecord(span.context) ? span.context : span;
}

function spanAttributes(span: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(span.attributes)) {
    return span.attributes;
  }
  const raw = stringValue(span.attributes);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function attributeString(
  attributes: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!attributes) {
    return undefined;
  }
  for (const key of keys) {
    const value = stringValue(attributes[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function attributeNumber(
  attributes: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | undefined {
  if (!attributes) {
    return undefined;
  }
  for (const key of keys) {
    const value = finiteNumber(attributes[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function tokenUsageFromSpan(
  span: Record<string, unknown>,
  attributes: Record<string, unknown> | undefined,
): PhoenixTokenUsage | undefined {
  const nested = isRecord(attributes?.token_usage) ? attributes.token_usage : {};
  return compactRecord({
    input: firstNumber(
      nested.input,
      nested.prompt,
      span.input_tokens,
      span.tokenCountPrompt,
      span.cumulativeTokenCountPrompt,
      attributeNumber(attributes, ['gen_ai.usage.input_tokens', 'llm.token_count.prompt']),
    ),
    output: firstNumber(
      nested.output,
      nested.completion,
      span.output_tokens,
      span.tokenCountCompletion,
      span.cumulativeTokenCountCompletion,
      attributeNumber(attributes, ['gen_ai.usage.output_tokens', 'llm.token_count.completion']),
    ),
    reasoning: firstNumber(nested.reasoning, attributes?.['gen_ai.usage.reasoning.output_tokens']),
    cached: firstNumber(nested.cached, attributes?.['gen_ai.usage.cache_read.input_tokens']),
    total: firstNumber(
      nested.total,
      span.total_tokens,
      span.tokenCountTotal,
      span.cumulativeTokenCountTotal,
      attributes?.total_tokens,
    ),
  }) as PhoenixTokenUsage | undefined;
}

function spanInput(span: Record<string, unknown>, attributes: Record<string, unknown> | undefined) {
  const input = isRecord(span.input) ? span.input.value : span.input;
  return (
    input ??
    attributes?.['input.value'] ??
    attributes?.input ??
    attributes?.['llm.input_messages'] ??
    attributes?.['gen_ai.prompt']
  );
}

function spanOutput(
  span: Record<string, unknown>,
  attributes: Record<string, unknown> | undefined,
) {
  const output = isRecord(span.output) ? span.output.value : span.output;
  return (
    output ??
    attributes?.['output.value'] ??
    attributes?.output ??
    attributes?.['llm.output_messages'] ??
    attributes?.['gen_ai.completion']
  );
}

function normalizeSpan(
  span: Record<string, unknown>,
  annotationsBySpanId: Map<string, PhoenixAnnotation[]>,
): PhoenixSpanDetail | undefined {
  const context = spanContext(span);
  const attributes = spanAttributes(span);
  const spanId =
    stringValue(context.span_id) ??
    stringValue(span.span_id) ??
    stringValue(span.spanId) ??
    stringValue(span.id);
  if (!spanId) {
    return undefined;
  }
  const trace = isRecord(span.trace) ? span.trace : undefined;
  const costSummary = isRecord(span.costSummary) ? span.costSummary : undefined;
  const totalCostSummary = isRecord(costSummary?.total) ? costSummary.total : undefined;
  const traceId =
    stringValue(context.trace_id) ?? stringValue(span.trace_id) ?? stringValue(trace?.traceId);
  const startTime = stringValue(span.start_time) ?? stringValue(span.startTime);
  const endTime = stringValue(span.end_time) ?? stringValue(span.endTime);
  const annotations = annotationsBySpanId.get(spanId);

  return compactRecord({
    span_id: spanId,
    trace_id: traceId,
    parent_span_id:
      stringValue(span.parent_id) ?? stringValue(span.parent_span_id) ?? stringValue(span.parentId),
    name: stringValue(span.name),
    span_kind:
      stringValue(span.span_kind) ??
      stringValue(span.spanKind) ??
      attributeString(attributes, ['openinference.span.kind', 'span.kind']),
    status:
      stringValue(span.status_code) ??
      stringValue(span.statusCode) ??
      stringValue(isRecord(span.status) ? span.status.code : undefined),
    start_time: startTime,
    end_time: endTime,
    duration_ms: finiteNumber(span.latency_ms) ?? durationMs(startTime, endTime),
    input: scrubCredentialFields(spanInput(span, attributes)),
    output: scrubCredentialFields(spanOutput(span, attributes)),
    token_usage: tokenUsageFromSpan(span, attributes),
    cost_usd: firstNumber(
      span.cost_usd,
      span.cost,
      totalCostSummary?.cost,
      attributes?.cost,
      attributes?.['llm.cost.usd'],
    ),
    attributes: scrubCredentialRecord(attributes),
    ...(annotations && annotations.length > 0 ? { annotations } : {}),
  }) as PhoenixSpanDetail | undefined;
}

function buildSpanTree(spans: readonly PhoenixSpanDetail[]): PhoenixTraceTreeNode[] {
  const childrenByParent = new Map<string | undefined, PhoenixSpanDetail[]>();
  for (const span of spans) {
    const parentId = span.parent_span_id;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(span);
    childrenByParent.set(parentId, children);
  }

  const visited = new Set<string>();
  const nodes: PhoenixTraceTreeNode[] = [];
  const roots = spans.filter(
    (span) => !span.parent_span_id || !spans.some((s) => s.span_id === span.parent_span_id),
  );

  function visit(span: PhoenixSpanDetail, depth: number): void {
    if (visited.has(span.span_id)) {
      return;
    }
    visited.add(span.span_id);
    const children = childrenByParent.get(span.span_id) ?? [];
    nodes.push({ ...span, depth, child_count: children.length });
    for (const child of children) {
      visit(child, depth + 1);
    }
  }

  for (const root of roots) {
    visit(root, 0);
  }
  for (const span of spans) {
    visit(span, 0);
  }
  return nodes;
}

function sumTokenUsage(
  items: readonly { token_usage?: PhoenixTokenUsage }[],
): PhoenixTokenUsage | undefined {
  const total: {
    input?: number;
    output?: number;
    reasoning?: number;
    cached?: number;
    total?: number;
  } = {};
  function add(key: keyof typeof total, value: number | undefined): void {
    if (value === undefined) {
      return;
    }
    total[key] = (total[key] ?? 0) + value;
  }
  for (const item of items) {
    const usage = item.token_usage;
    if (!usage) {
      continue;
    }
    add('input', usage.input);
    add('output', usage.output);
    add('reasoning', usage.reasoning);
    add('cached', usage.cached);
    add('total', usage.total);
  }
  return compactRecord(total) as PhoenixTokenUsage | undefined;
}

function tokenUsageFromGraphql(value: unknown): PhoenixTokenUsage | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record) {
    return undefined;
  }
  return compactRecord({
    input: firstNumber(record.input, record.prompt),
    output: firstNumber(record.output, record.completion),
    reasoning: finiteNumber(record.reasoning),
    cached: finiteNumber(record.cached),
    total: finiteNumber(record.total),
  }) as PhoenixTokenUsage | undefined;
}

function costFromGraphqlSummary(value: unknown): number | undefined {
  const record = isRecord(value) ? value : undefined;
  const total = isRecord(record?.total) ? record.total : undefined;
  return finiteNumber(total?.cost);
}

function annotationsByTarget(
  annotations: readonly PhoenixAnnotation[],
  target: 'trace' | 'span',
): Map<string, PhoenixAnnotation[]> {
  const byTarget = new Map<string, PhoenixAnnotation[]>();
  for (const annotation of annotations) {
    if (annotation.target !== target || !annotation.target_id) {
      continue;
    }
    const entries = byTarget.get(annotation.target_id) ?? [];
    entries.push(annotation);
    byTarget.set(annotation.target_id, entries);
  }
  return byTarget;
}

function graphqlSpanId(span: Record<string, unknown>): string | undefined {
  const context = spanContext(span);
  return stringValue(context.span_id) ?? stringValue(span.span_id) ?? stringValue(span.spanId);
}

function graphqlTraceRows(session: PhoenixRestSession): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const trace of session.traces) {
    const rawTrace = trace.raw;
    if (!rawTrace) {
      continue;
    }
    const candidates = [
      ...(isRecord(rawTrace.rootSpan) ? [rawTrace.rootSpan] : []),
      ...connectionNodes(rawTrace.spans),
    ];
    for (const span of candidates) {
      const spanId = graphqlSpanId(span);
      const dedupeKey = `${trace.traceId ?? ''}:${spanId ?? JSON.stringify(span)}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      rows.push(span);
    }
  }
  return rows;
}

function graphqlAnnotations(
  entries: readonly unknown[],
  target: 'session' | 'trace' | 'span',
  targetId?: string,
): PhoenixAnnotation[] {
  return entries
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((annotation) => normalizeAnnotation(annotation, target, targetId));
}

function graphqlSessionAnnotations(session: PhoenixRestSession): PhoenixAnnotation[] {
  return graphqlAnnotations(
    asArray(session.raw?.sessionAnnotations),
    'session',
    session.sessionId ?? session.id,
  );
}

function graphqlTraceAnnotations(session: PhoenixRestSession): PhoenixAnnotation[] {
  return session.traces.flatMap((trace) =>
    graphqlAnnotations(asArray(trace.raw?.traceAnnotations), 'trace', trace.traceId),
  );
}

function graphqlSpanAnnotations(spans: readonly Record<string, unknown>[]): PhoenixAnnotation[] {
  return spans.flatMap((span) =>
    graphqlAnnotations(asArray(span.spanAnnotations), 'span', graphqlSpanId(span)),
  );
}

function sessionIdFromSpans(spans: readonly Record<string, unknown>[]): string | undefined {
  for (const span of spans) {
    const attributes = spanAttributes(span);
    const sessionId =
      attributeString(attributes, [
        'session.id',
        'session_id',
        'metadata.session_id',
        'openinference.session.id',
      ]) ?? stringValue(span.session_id);
    if (sessionId) {
      return sessionId;
    }
  }
  return undefined;
}

function buildOpenInPhoenixUrl(
  config: PhoenixConfig,
  externalTrace: ExternalTraceMetadata,
  session: PhoenixRestSession | undefined,
): string | undefined {
  if (externalTrace.uiUrl) {
    return externalTrace.uiUrl;
  }
  const sessionId = session?.sessionId ?? externalTrace.sessionId ?? externalTrace.sessionNodeId;
  if (sessionId) {
    return `${config.baseUrl}/sessions/${encodeURIComponent(sessionId)}`;
  }
  if (externalTrace.traceId) {
    return `${config.baseUrl}/projects/${encodeURIComponent(
      externalTrace.projectId ?? externalTrace.project ?? config.project ?? '',
    )}/traces/${encodeURIComponent(externalTrace.traceId)}`;
  }
  return config.baseUrl;
}

async function buildLinkedSessionResponse(
  externalTrace: ExternalTraceMetadata,
  externalTraceWire: ExternalTraceMetadataWire,
  config: PhoenixConfig,
  session: PhoenixRestSession,
  fetchImpl: typeof fetch,
): Promise<PhoenixLinkedSessionResponse> {
  const projectIdentifier =
    session.projectId ?? externalTrace.projectId ?? externalTrace.project ?? config.project;
  const traceIds = session.traces.map((trace) => trace.traceId).filter((id): id is string => !!id);
  const graphqlSpanRows = graphqlTraceRows(session);
  const spanRows =
    graphqlSpanRows.length > 0
      ? graphqlSpanRows
      : projectIdentifier
        ? (
            await Promise.all(
              traceIds.map((traceId) =>
                fetchTraceSpans(config, projectIdentifier, traceId, fetchImpl),
              ),
            )
          ).flat()
        : [];

  const graphqlSessionAnnotationRows = graphqlSessionAnnotations(session);
  const graphqlTraceAnnotationRows = graphqlTraceAnnotations(session);
  const graphqlSpanAnnotationRows = graphqlSpanAnnotations(spanRows);
  const shouldFetchRestAnnotations =
    projectIdentifier &&
    graphqlSessionAnnotationRows.length === 0 &&
    graphqlTraceAnnotationRows.length === 0 &&
    graphqlSpanAnnotationRows.length === 0;

  const [sessionAnnotations, traceAnnotations, spanAnnotations] = shouldFetchRestAnnotations
    ? await Promise.all([
        fetchAnnotations(
          config,
          projectIdentifier,
          'session',
          [session.sessionId, session.id].filter((id): id is string => !!id),
          fetchImpl,
        ),
        fetchAnnotations(config, projectIdentifier, 'trace', traceIds, fetchImpl),
        fetchAnnotations(
          config,
          projectIdentifier,
          'span',
          spanRows.map(graphqlSpanId).filter((id): id is string => !!id),
          fetchImpl,
        ),
      ])
    : [graphqlSessionAnnotationRows, graphqlTraceAnnotationRows, graphqlSpanAnnotationRows];

  const spanAnnotationsById = annotationsByTarget(spanAnnotations, 'span');
  const spans = spanRows
    .map((span) => normalizeSpan(span, spanAnnotationsById))
    .filter((span): span is PhoenixSpanDetail => span !== undefined);
  const spansByTraceId = new Map<string, PhoenixSpanDetail[]>();
  for (const span of spans) {
    if (!span.trace_id) {
      continue;
    }
    const traceSpans = spansByTraceId.get(span.trace_id) ?? [];
    traceSpans.push(span);
    spansByTraceId.set(span.trace_id, traceSpans);
  }
  const traceAnnotationsById = annotationsByTarget(traceAnnotations, 'trace');
  const turns = session.traces.map((trace, index) => {
    const traceSpans = trace.traceId ? (spansByTraceId.get(trace.traceId) ?? []) : [];
    const rootSpan = traceSpans.find((span) => !span.parent_span_id) ?? traceSpans[0];
    const startTime = trace.startTime ?? rootSpan?.start_time;
    const endTime = trace.endTime ?? rootSpan?.end_time;
    const annotations = trace.traceId ? traceAnnotationsById.get(trace.traceId) : undefined;
    return compactRecord({
      index: index + 1,
      trace_id: trace.traceId,
      start_time: startTime,
      end_time: endTime,
      duration_ms: durationMs(startTime, endTime) ?? rootSpan?.duration_ms,
      status: rootSpan?.status,
      root_span_id: rootSpan?.span_id,
      input: rootSpan?.input,
      output: rootSpan?.output,
      token_usage: sumTokenUsage(traceSpans),
      cost_usd: traceSpans.reduce((sum, span) => sum + (span.cost_usd ?? 0), 0),
      ...(annotations && annotations.length > 0 ? { annotations } : {}),
    }) as PhoenixSessionTurn;
  });

  const summary: PhoenixSessionSummary = {
    id: session.id,
    session_id: session.sessionId,
    project_id: projectIdentifier,
    project: externalTrace.project,
    start_time: session.startTime,
    end_time: session.endTime,
    duration_ms: durationMs(session.startTime, session.endTime),
    trace_count: finiteNumber(session.raw?.numTraces) ?? traceIds.length,
    token_usage: tokenUsageFromGraphql(session.raw?.tokenUsage) ?? sumTokenUsage(turns),
    cost_usd:
      costFromGraphqlSummary(session.raw?.costSummary) ??
      turns.reduce((sum, turn) => sum + (turn.cost_usd ?? 0), 0),
    ...(sessionAnnotations.length > 0 ? { annotations: sessionAnnotations } : {}),
  };
  const annotations = [...sessionAnnotations, ...traceAnnotations, ...spanAnnotations];

  return response('ok', 'Linked Phoenix session loaded.', externalTraceWire, {
    open_in_phoenix_url: buildOpenInPhoenixUrl(config, externalTrace, session),
    session: summary,
    turns,
    spans,
    trace_tree: buildSpanTree(spans),
    ...(annotations.length > 0 ? { annotations } : {}),
  });
}

async function resolveSession(
  externalTrace: ExternalTraceMetadata,
  config: PhoenixConfig,
  fetchImpl: typeof fetch,
): Promise<PhoenixRestSession | undefined> {
  const projectIdentifier = externalTrace.projectId ?? externalTrace.project ?? config.project;

  if (externalTrace.sessionNodeId) {
    try {
      const session = await fetchSessionByNodeId(config, externalTrace.sessionNodeId, fetchImpl);
      if (session) {
        return session;
      }
    } catch (error) {
      if (!(error instanceof PhoenixReadError && error.code === 'schema_mismatch')) {
        throw error;
      }
      // REST is only a compatibility fallback when the configured Phoenix
      // GraphQL schema lacks the web-equivalent fields AgentV needs.
    }
    return fetchSessionByIdRest(config, externalTrace.sessionNodeId, fetchImpl);
  }

  if (externalTrace.sessionId) {
    if (projectIdentifier) {
      try {
        const session = await fetchSessionByIdGraphql(
          config,
          projectIdentifier,
          externalTrace.sessionId,
          fetchImpl,
        );
        if (session) {
          return session;
        }
      } catch (error) {
        if (!(error instanceof PhoenixReadError && error.code === 'schema_mismatch')) {
          throw error;
        }
        // Project-scoped GraphQL lookup requires a Phoenix GraphQL project ID.
        // REST remains a narrow fallback for configured project names or older
        // Phoenix schemas without the session read fields used by the web UI.
      }
    }
    return fetchSessionByIdRest(config, externalTrace.sessionId, fetchImpl);
  }

  const traceId = externalTrace.traceId;
  if (!traceId || !projectIdentifier) {
    return undefined;
  }

  try {
    const session = await fetchSessionByTraceIdGraphql(
      config,
      projectIdentifier,
      traceId,
      fetchImpl,
    );
    if (session) {
      return session;
    }
  } catch (error) {
    if (!(error instanceof PhoenixReadError && error.code === 'schema_mismatch')) {
      throw error;
    }
    // Fallback path for project-name configs or older Phoenix GraphQL schemas:
    // use the public spans API only to recover the session ID from trace attrs.
  }

  const spans = await fetchTraceSpans(config, projectIdentifier, traceId, fetchImpl);
  const resolvedSessionId = sessionIdFromSpans(spans);
  if (!resolvedSessionId) {
    return undefined;
  }
  return fetchSessionByIdRest(config, resolvedSessionId, fetchImpl);
}

export async function readPhoenixLinkedSession(
  externalTrace: ExternalTraceMetadata | undefined,
  externalTraceWire: ExternalTraceMetadataWire | undefined,
  options: ReadPhoenixLinkedSessionOptions = {},
): Promise<PhoenixLinkedSessionResponse> {
  if (!externalTrace || !externalTraceWire) {
    return response(
      'missing_external_trace',
      'This AgentV run does not include external_trace metadata.',
      undefined,
    );
  }

  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const config = resolvePhoenixConfig(externalTrace, env);
  if (!config) {
    return response(
      'not_configured',
      'Phoenix read-through is not configured. Set AGENTV_PHOENIX_ENDPOINT or PHOENIX_HOST on the Dashboard server.',
      externalTraceWire,
      { open_in_phoenix_url: externalTrace.uiUrl },
    );
  }

  try {
    const session = await resolveSession(externalTrace, config, fetchImpl);
    if (!session) {
      return response(
        'unresolved',
        'No Phoenix session matched the external_trace correlation metadata.',
        externalTraceWire,
        { open_in_phoenix_url: buildOpenInPhoenixUrl(config, externalTrace, undefined) },
      );
    }
    return buildLinkedSessionResponse(externalTrace, externalTraceWire, config, session, fetchImpl);
  } catch (error) {
    if (error instanceof PhoenixReadError) {
      return response(error.code, error.message, externalTraceWire, {
        open_in_phoenix_url: buildOpenInPhoenixUrl(config, externalTrace, undefined),
      });
    }
    return response(
      'unreachable',
      `Phoenix read-through failed: ${error instanceof Error ? error.message : String(error)}`,
      externalTraceWire,
      { open_in_phoenix_url: buildOpenInPhoenixUrl(config, externalTrace, undefined) },
    );
  }
}
