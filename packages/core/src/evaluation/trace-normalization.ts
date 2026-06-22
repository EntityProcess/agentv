/**
 * Dashboard trace normalization.
 *
 * This module accepts raw trace artifacts that are already owned by AgentV
 * (`agentv.trace.v1`) or standards-shaped OTLP/OpenInference JSON, then projects
 * them into the shared Dashboard trace/session read model. It deliberately
 * avoids Phoenix-specific concepts; backend-specific mapping belongs in
 * adapters before or after this generic normalization boundary.
 */

import {
  type TraceSessionConversionWarning,
  type TraceSessionProjectionOptions,
  type TraceSessionResponse,
  traceEnvelopeToTraceSessionResponse,
} from './dashboard-trace-read-model.js';
import { EXECUTION_TRACE_SCHEMA_VERSION } from './trace-envelope.js';

const TRACE_ENVELOPE_FORMAT = 'otlp_openinference_spans' as const;

export interface TraceArtifactNormalizationOptions extends TraceSessionProjectionOptions {
  runId?: string;
  testId?: string;
  suite?: string;
  target?: string;
  now?: () => Date;
}

export type TraceArtifactNormalizationResult =
  | {
      status: 'ok';
      format: 'agentv_trace_v1' | 'otlp_json';
      traceSession: TraceSessionResponse;
      warnings?: readonly TraceSessionConversionWarning[];
    }
  | {
      status: 'unsupported';
      message: string;
      warnings?: readonly TraceSessionConversionWarning[];
    };

type WarningSink = TraceSessionConversionWarning[];

interface WarningContext {
  readonly rawKind?: string;
  readonly path?: string;
  readonly spanId?: string;
  readonly details?: Record<string, unknown>;
}

interface NormalizedOtlpSpan {
  readonly trace_id?: string;
  readonly span_id: string;
  readonly parent_span_id?: string | null;
  readonly name: string;
  readonly kind?: string;
  readonly start_time_unix_nano?: string;
  readonly end_time_unix_nano?: string;
  readonly status?: {
    readonly code?: string;
    readonly message?: string;
  };
  readonly resource_attributes?: Record<string, unknown>;
  readonly attributes?: Record<string, unknown>;
  readonly events?: readonly {
    readonly name: string;
    readonly time_unix_nano?: string;
    readonly attributes?: Record<string, unknown>;
  }[];
}

interface ParsedOtlpValue {
  readonly ok: boolean;
  readonly value?: unknown;
}

const OTLP_ROOT_FIELDS = new Set(['resourceSpans']);
const OTLP_RESOURCE_SPAN_FIELDS = new Set(['resource', 'scopeSpans', 'schemaUrl']);
const OTLP_RESOURCE_FIELDS = new Set(['attributes', 'droppedAttributesCount']);
const OTLP_SCOPE_SPAN_FIELDS = new Set(['scope', 'spans', 'schemaUrl']);
const OTLP_SCOPE_FIELDS = new Set(['name', 'version', 'attributes', 'droppedAttributesCount']);
const OTLP_SPAN_FIELDS = new Set([
  'traceId',
  'spanId',
  'parentSpanId',
  'traceState',
  'name',
  'kind',
  'startTimeUnixNano',
  'endTimeUnixNano',
  'attributes',
  'droppedAttributesCount',
  'events',
  'droppedEventsCount',
  'links',
  'droppedLinksCount',
  'status',
]);
const OTLP_EVENT_FIELDS = new Set(['timeUnixNano', 'name', 'attributes', 'droppedAttributesCount']);
const OTLP_STATUS_FIELDS = new Set(['code', 'message']);
const OTLP_ATTRIBUTE_FIELDS = new Set(['key', 'value']);
const OTLP_ANY_VALUE_FIELDS = new Set([
  'stringValue',
  'boolValue',
  'intValue',
  'doubleValue',
  'arrayValue',
  'kvlistValue',
  'bytesValue',
]);

export function normalizeTraceArtifactToTraceSessionResponse(
  input: unknown,
  options: TraceArtifactNormalizationOptions = {},
): TraceArtifactNormalizationResult {
  const artifact = asRecord(input);
  if (!artifact) {
    return {
      status: 'unsupported',
      message: 'Trace artifact is not a JSON object.',
    };
  }

  if (stringValue(artifact.schema_version) === EXECUTION_TRACE_SCHEMA_VERSION) {
    return normalizeAgentVTraceEnvelope(artifact, options);
  }

  if (Object.hasOwn(artifact, 'resourceSpans')) {
    return normalizeOtlpJson(artifact, options);
  }

  return {
    status: 'unsupported',
    message: 'Trace artifact is not an agentv.trace.v1 envelope or OTLP JSON resourceSpans body.',
  };
}

function normalizeAgentVTraceEnvelope(
  artifact: Record<string, unknown>,
  options: TraceArtifactNormalizationOptions,
): TraceArtifactNormalizationResult {
  const trace = asRecord(artifact.trace);
  if (!Array.isArray(trace?.spans)) {
    return {
      status: 'unsupported',
      message: 'Trace artifact is not an agentv.trace.v1 envelope with trace.spans.',
    };
  }

  const traceSession = traceEnvelopeToTraceSessionResponse(artifact, options);
  return {
    status: 'ok',
    format: 'agentv_trace_v1',
    traceSession,
    warnings: traceSession.conversion_warnings,
  };
}

function normalizeOtlpJson(
  artifact: Record<string, unknown>,
  options: TraceArtifactNormalizationOptions,
): TraceArtifactNormalizationResult {
  const warnings: WarningSink = [];
  warnUnknownFields(artifact, OTLP_ROOT_FIELDS, warnings, {
    rawKind: 'otlp_json',
    path: options.artifactPath,
  });

  const resourceSpans = Array.isArray(artifact.resourceSpans) ? artifact.resourceSpans : [];
  if (!Array.isArray(artifact.resourceSpans)) {
    addWarning(warnings, 'malformed_otlp_resource_spans', 'OTLP resourceSpans must be an array.', {
      rawKind: 'otlp_json',
      path: options.artifactPath,
    });
  }

  const spans: NormalizedOtlpSpan[] = [];
  const resourceAttributeSets: Record<string, unknown>[] = [];
  let scopeSpanCount = 0;
  let firstScope: { name?: string; version?: string } | undefined;

  resourceSpans.forEach((resourceSpan, resourceSpanIndex) => {
    const resourceRecord = asRecord(resourceSpan);
    if (!resourceRecord) {
      addWarning(
        warnings,
        'malformed_otlp_resource_span',
        'OTLP resourceSpans entry must be an object and was skipped.',
        {
          rawKind: 'otlp_resource_span',
          path: options.artifactPath,
          details: { resource_span_index: resourceSpanIndex },
        },
      );
      return;
    }

    warnUnknownFields(resourceRecord, OTLP_RESOURCE_SPAN_FIELDS, warnings, {
      rawKind: 'otlp_resource_span',
      path: options.artifactPath,
      details: { resource_span_index: resourceSpanIndex },
    });

    const resource = asRecord(resourceRecord.resource);
    if (resource) {
      warnUnknownFields(resource, OTLP_RESOURCE_FIELDS, warnings, {
        rawKind: 'otlp_resource',
        path: options.artifactPath,
        details: { resource_span_index: resourceSpanIndex },
      });
    }
    const resourceAttributes = parseOtlpAttributes(resource?.attributes, warnings, {
      rawKind: 'otlp_resource_attributes',
      path: options.artifactPath,
      details: { resource_span_index: resourceSpanIndex },
    });
    if (resourceAttributes && Object.keys(resourceAttributes).length > 0) {
      resourceAttributeSets.push(resourceAttributes);
    }

    const scopeSpans = Array.isArray(resourceRecord.scopeSpans) ? resourceRecord.scopeSpans : [];
    if (!Array.isArray(resourceRecord.scopeSpans)) {
      addWarning(
        warnings,
        'malformed_otlp_scope_spans',
        'OTLP resourceSpans.scopeSpans must be an array and was skipped.',
        {
          rawKind: 'otlp_resource_span',
          path: options.artifactPath,
          details: { resource_span_index: resourceSpanIndex },
        },
      );
    }

    scopeSpans.forEach((scopeSpan, scopeSpanIndex) => {
      const scopeSpanRecord = asRecord(scopeSpan);
      if (!scopeSpanRecord) {
        addWarning(
          warnings,
          'malformed_otlp_scope_span',
          'OTLP scopeSpans entry must be an object and was skipped.',
          {
            rawKind: 'otlp_scope_span',
            path: options.artifactPath,
            details: { resource_span_index: resourceSpanIndex, scope_span_index: scopeSpanIndex },
          },
        );
        return;
      }

      scopeSpanCount += 1;
      warnUnknownFields(scopeSpanRecord, OTLP_SCOPE_SPAN_FIELDS, warnings, {
        rawKind: 'otlp_scope_span',
        path: options.artifactPath,
        details: { resource_span_index: resourceSpanIndex, scope_span_index: scopeSpanIndex },
      });

      const scope = normalizeOtlpScope(scopeSpanRecord.scope, warnings, {
        rawKind: 'otlp_scope',
        path: options.artifactPath,
        details: { resource_span_index: resourceSpanIndex, scope_span_index: scopeSpanIndex },
      });
      firstScope ??= scope;

      const otlpSpans = Array.isArray(scopeSpanRecord.spans) ? scopeSpanRecord.spans : [];
      if (!Array.isArray(scopeSpanRecord.spans)) {
        addWarning(
          warnings,
          'malformed_otlp_spans',
          'OTLP scopeSpans.spans must be an array and was skipped.',
          {
            rawKind: 'otlp_scope_span',
            path: options.artifactPath,
            details: { resource_span_index: resourceSpanIndex, scope_span_index: scopeSpanIndex },
          },
        );
      }

      otlpSpans.forEach((span, spanIndex) => {
        const normalized = normalizeOtlpSpan(span, warnings, {
          resourceAttributes,
          path: options.artifactPath,
          resourceSpanIndex,
          scopeSpanIndex,
          spanIndex,
        });
        if (normalized) {
          spans.push(normalized);
        }
      });
    });
  });

  if (spans.length === 0) {
    addWarning(warnings, 'empty_otlp_trace', 'OTLP JSON did not contain any readable spans.', {
      rawKind: 'otlp_json',
      path: options.artifactPath,
    });
  }

  const traceId = firstString(spans.map((span) => span.trace_id));
  const rootSpanId = firstRootSpanId(spans);
  const resourceAttributes = singleDistinctRecord(resourceAttributeSets);
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const artifactPath = options.artifactPath;
  const envelope = dropUndefined({
    schema_version: EXECUTION_TRACE_SCHEMA_VERSION,
    artifact_id: `otlp-trace-${traceId ?? rootSpanId ?? 'unknown'}`,
    created_at: createdAt,
    eval: dropUndefined({
      run_id: options.runId,
      test_id: options.testId ?? traceId ?? 'otlp-trace',
      suite: options.suite,
      target: options.target ?? 'unknown',
    }),
    trace: dropUndefined({
      format: TRACE_ENVELOPE_FORMAT,
      trace_id: traceId,
      root_span_id: rootSpanId,
      resource: resourceAttributes ? { attributes: resourceAttributes } : undefined,
      scope: firstScope,
      spans,
    }),
    source: dropUndefined({
      kind: 'otlp',
      path: artifactPath,
      format: 'otlp_json',
      version: '1',
      metadata: dropUndefined({
        resource_spans_count: resourceSpans.length,
        scope_spans_count: scopeSpanCount,
      }),
    }),
    capture: {
      content: 'metadata',
      redaction_level: 'partial',
    },
    conversion_warnings: warnings.length > 0 ? warnings : undefined,
    artifacts: artifactPath ? { raw_trace_path: artifactPath } : undefined,
  });

  const traceSession = traceEnvelopeToTraceSessionResponse(envelope, options);
  return {
    status: 'ok',
    format: 'otlp_json',
    traceSession,
    warnings: traceSession.conversion_warnings,
  };
}

function normalizeOtlpScope(
  value: unknown,
  warnings: WarningSink,
  context: WarningContext,
): { name?: string; version?: string } | undefined {
  if (value === undefined) {
    return undefined;
  }
  const scope = asRecord(value);
  if (!scope) {
    addWarning(warnings, 'malformed_otlp_scope', 'OTLP scope must be an object and was ignored.', {
      ...context,
      rawKind: context.rawKind ?? 'otlp_scope',
    });
    return undefined;
  }
  warnUnknownFields(scope, OTLP_SCOPE_FIELDS, warnings, context);
  const normalized = dropUndefined({
    name: stringValue(scope.name),
    version: stringValue(scope.version),
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeOtlpSpan(
  value: unknown,
  warnings: WarningSink,
  context: {
    readonly resourceAttributes?: Record<string, unknown>;
    readonly path?: string;
    readonly resourceSpanIndex: number;
    readonly scopeSpanIndex: number;
    readonly spanIndex: number;
  },
): NormalizedOtlpSpan | undefined {
  const span = asRecord(value);
  const details = {
    resource_span_index: context.resourceSpanIndex,
    scope_span_index: context.scopeSpanIndex,
    span_index: context.spanIndex,
  };
  if (!span) {
    addWarning(warnings, 'malformed_otlp_span', 'OTLP span must be an object and was skipped.', {
      rawKind: 'otlp_span',
      path: context.path,
      details,
    });
    return undefined;
  }

  warnUnknownFields(span, OTLP_SPAN_FIELDS, warnings, {
    rawKind: 'otlp_span',
    path: context.path,
    details,
  });

  const spanId =
    stringValue(span.spanId) ??
    `missing-span-${context.resourceSpanIndex}-${context.scopeSpanIndex}-${context.spanIndex}`;
  if (!stringValue(span.spanId)) {
    addWarning(
      warnings,
      'missing_span_id',
      'OTLP span was missing spanId; a stable ID was assigned.',
      {
        rawKind: 'otlp_span',
        path: context.path,
        spanId,
        details,
      },
    );
  }

  const traceId = stringValue(span.traceId);
  if (!traceId) {
    addWarning(warnings, 'missing_trace_id', 'OTLP span was missing traceId.', {
      rawKind: 'otlp_span',
      path: context.path,
      spanId,
      details,
    });
  }

  const name = stringValue(span.name) ?? spanId;
  if (!stringValue(span.name)) {
    addWarning(warnings, 'missing_span_name', 'OTLP span was missing name; spanId was used.', {
      rawKind: 'otlp_span',
      path: context.path,
      spanId,
      details,
    });
  }

  const parentSpanId =
    span.parentSpanId === undefined || span.parentSpanId === null || span.parentSpanId === ''
      ? null
      : stringValue(span.parentSpanId);
  if (
    span.parentSpanId !== undefined &&
    span.parentSpanId !== null &&
    span.parentSpanId !== '' &&
    !parentSpanId
  ) {
    addWarning(
      warnings,
      'malformed_parent_span_id',
      'OTLP span parentSpanId was not a string and was ignored.',
      {
        rawKind: 'otlp_span',
        path: context.path,
        spanId,
        details,
      },
    );
  }

  const attributes = parseOtlpAttributes(span.attributes, warnings, {
    rawKind: 'otlp_span_attributes',
    path: context.path,
    spanId,
    details,
  });
  const events = normalizeOtlpEvents(span.events, warnings, {
    path: context.path,
    spanId,
    details,
  });

  return dropUndefined({
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: parentSpanId,
    name,
    kind: normalizeOtlpSpanKind(span.kind, warnings, {
      rawKind: 'otlp_span',
      path: context.path,
      spanId,
      details,
    }),
    start_time_unix_nano: normalizeUnixNano(span.startTimeUnixNano, 'startTimeUnixNano', warnings, {
      rawKind: 'otlp_span',
      path: context.path,
      spanId,
      details,
    }),
    end_time_unix_nano: normalizeUnixNano(span.endTimeUnixNano, 'endTimeUnixNano', warnings, {
      rawKind: 'otlp_span',
      path: context.path,
      spanId,
      details,
    }),
    status: normalizeOtlpStatus(span.status, warnings, {
      rawKind: 'otlp_span_status',
      path: context.path,
      spanId,
      details,
    }),
    resource_attributes: context.resourceAttributes,
    attributes,
    events,
  });
}

function normalizeOtlpEvents(
  value: unknown,
  warnings: WarningSink,
  context: {
    readonly path?: string;
    readonly spanId: string;
    readonly details: Record<string, unknown>;
  },
):
  | readonly {
      readonly name: string;
      readonly time_unix_nano?: string;
      readonly attributes?: Record<string, unknown>;
    }[]
  | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    addWarning(warnings, 'malformed_otlp_events', 'OTLP span events must be an array.', {
      rawKind: 'otlp_span_events',
      path: context.path,
      spanId: context.spanId,
      details: context.details,
    });
    return undefined;
  }

  const events = value.flatMap((event, eventIndex) => {
    const eventRecord = asRecord(event);
    const details = { ...context.details, event_index: eventIndex };
    if (!eventRecord) {
      addWarning(
        warnings,
        'malformed_otlp_event',
        'OTLP span event must be an object and was skipped.',
        {
          rawKind: 'otlp_span_event',
          path: context.path,
          spanId: context.spanId,
          details,
        },
      );
      return [];
    }

    warnUnknownFields(eventRecord, OTLP_EVENT_FIELDS, warnings, {
      rawKind: 'otlp_span_event',
      path: context.path,
      spanId: context.spanId,
      details,
    });

    const name = stringValue(eventRecord.name) ?? `event-${eventIndex}`;
    if (!stringValue(eventRecord.name)) {
      addWarning(
        warnings,
        'missing_event_name',
        'OTLP span event was missing name; a stable name was assigned.',
        {
          rawKind: 'otlp_span_event',
          path: context.path,
          spanId: context.spanId,
          details,
        },
      );
    }

    return [
      dropUndefined({
        name,
        time_unix_nano: normalizeUnixNano(eventRecord.timeUnixNano, 'timeUnixNano', warnings, {
          rawKind: 'otlp_span_event',
          path: context.path,
          spanId: context.spanId,
          details,
        }),
        attributes: parseOtlpAttributes(eventRecord.attributes, warnings, {
          rawKind: 'otlp_event_attributes',
          path: context.path,
          spanId: context.spanId,
          details,
        }),
      }),
    ];
  });

  return events.length > 0 ? events : undefined;
}

function parseOtlpAttributes(
  value: unknown,
  warnings: WarningSink,
  context: WarningContext,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (asRecord(value)) {
    addWarning(
      warnings,
      'nonstandard_otlp_attribute_map',
      'OTLP attributes were an object map; values were preserved as-is.',
      context,
    );
    return value as Record<string, unknown>;
  }
  if (!Array.isArray(value)) {
    addWarning(warnings, 'malformed_otlp_attributes', 'OTLP attributes must be an array.', context);
    return undefined;
  }

  const attributes: Record<string, unknown> = {};
  value.forEach((attribute, attributeIndex) => {
    const attributeRecord = asRecord(attribute);
    const details = { ...(context.details ?? {}), attribute_index: attributeIndex };
    if (!attributeRecord) {
      addWarning(
        warnings,
        'malformed_otlp_attribute',
        'OTLP attribute must be an object and was skipped.',
        { ...context, details },
      );
      return;
    }

    warnUnknownFields(attributeRecord, OTLP_ATTRIBUTE_FIELDS, warnings, {
      ...context,
      rawKind: context.rawKind ?? 'otlp_attribute',
      details,
    });

    const key = stringValue(attributeRecord.key);
    if (!key) {
      addWarning(
        warnings,
        'malformed_otlp_attribute',
        'OTLP attribute was missing key and was skipped.',
        {
          ...context,
          details,
        },
      );
      return;
    }

    if (Object.hasOwn(attributes, key)) {
      addWarning(
        warnings,
        'duplicate_otlp_attribute',
        `OTLP attribute "${key}" appeared more than once; the last value was used.`,
        {
          ...context,
          details: { ...details, key },
        },
      );
    }

    const parsed = parseOtlpAnyValue(attributeRecord.value, warnings, {
      ...context,
      rawKind: 'otlp_attribute_value',
      details: { ...details, key },
    });
    if (parsed.ok) {
      attributes[key] = parsed.value;
    }
  });

  return Object.keys(attributes).length > 0 ? attributes : undefined;
}

function parseOtlpAnyValue(
  value: unknown,
  warnings: WarningSink,
  context: WarningContext,
): ParsedOtlpValue {
  if (isPrimitive(value)) {
    addWarning(
      warnings,
      'nonstandard_otlp_value',
      'OTLP attribute value was primitive; value was preserved as-is.',
      context,
    );
    return { ok: true, value };
  }

  const record = asRecord(value);
  if (!record) {
    addWarning(
      warnings,
      'malformed_otlp_value',
      'OTLP attribute value must be an object.',
      context,
    );
    return { ok: false };
  }

  const presentFields = Object.keys(record).filter((key) => OTLP_ANY_VALUE_FIELDS.has(key));
  const unknownFields = Object.keys(record).filter((key) => !OTLP_ANY_VALUE_FIELDS.has(key));
  if (unknownFields.length > 0) {
    addWarning(
      warnings,
      'unknown_otlp_value_field',
      `Unknown OTLP attribute value field(s) ignored: ${unknownFields.join(', ')}.`,
      { ...context, details: { ...(context.details ?? {}), fields: unknownFields } },
    );
  }
  if (presentFields.length > 1) {
    addWarning(
      warnings,
      'ambiguous_otlp_value',
      `OTLP attribute value had multiple value fields; ${presentFields[0]} was used.`,
      { ...context, details: { ...(context.details ?? {}), fields: presentFields } },
    );
  }

  const field = presentFields[0];
  if (!field) {
    addWarning(
      warnings,
      'malformed_otlp_value',
      'OTLP attribute value did not contain a recognized value field; raw value was preserved.',
      context,
    );
    return { ok: true, value };
  }

  switch (field) {
    case 'stringValue':
    case 'bytesValue':
      return { ok: true, value: stringValue(record[field]) ?? String(record[field] ?? '') };
    case 'boolValue':
      return { ok: true, value: Boolean(record.boolValue) };
    case 'intValue':
      return { ok: true, value: integerOrString(record.intValue) };
    case 'doubleValue':
      return { ok: true, value: numberOrString(record.doubleValue) };
    case 'arrayValue':
      return parseOtlpArrayValue(record.arrayValue, warnings, context);
    case 'kvlistValue':
      return parseOtlpKeyValueList(record.kvlistValue, warnings, context);
    default:
      return { ok: true, value };
  }
}

function parseOtlpArrayValue(
  value: unknown,
  warnings: WarningSink,
  context: WarningContext,
): ParsedOtlpValue {
  const arrayValue = asRecord(value);
  if (!arrayValue || !Array.isArray(arrayValue.values)) {
    addWarning(
      warnings,
      'malformed_otlp_array_value',
      'OTLP arrayValue.values must be an array.',
      context,
    );
    return { ok: false };
  }
  return {
    ok: true,
    value: arrayValue.values.map(
      (entry, index) =>
        parseOtlpAnyValue(entry, warnings, {
          ...context,
          details: { ...(context.details ?? {}), value_index: index },
        }).value,
    ),
  };
}

function parseOtlpKeyValueList(
  value: unknown,
  warnings: WarningSink,
  context: WarningContext,
): ParsedOtlpValue {
  const kvlistValue = asRecord(value);
  if (!kvlistValue || !Array.isArray(kvlistValue.values)) {
    addWarning(
      warnings,
      'malformed_otlp_kvlist_value',
      'OTLP kvlistValue.values must be an array.',
      context,
    );
    return { ok: false };
  }
  return {
    ok: true,
    value: parseOtlpAttributes(kvlistValue.values, warnings, context) ?? {},
  };
}

function normalizeOtlpSpanKind(
  value: unknown,
  warnings: WarningSink,
  context: WarningContext,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value.replace(/^SPAN_KIND_/, '');
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    addWarning(
      warnings,
      'malformed_span_kind',
      'OTLP span kind was not a string or integer.',
      context,
    );
    return undefined;
  }
  if (value === 0) return 'INTERNAL';
  if (value === 1) return 'SERVER';
  if (value === 2) return 'CLIENT';
  if (value === 3) return 'PRODUCER';
  if (value === 4 || value === 5) return 'CONSUMER';
  addWarning(
    warnings,
    'unknown_span_kind',
    `Unknown OTLP span kind ${value} was preserved as a string.`,
    context,
  );
  return String(value);
}

function normalizeOtlpStatus(
  value: unknown,
  warnings: WarningSink,
  context: WarningContext,
): { code?: string; message?: string } | undefined {
  if (value === undefined) {
    return undefined;
  }
  const status = asRecord(value);
  if (!status) {
    addWarning(warnings, 'malformed_otlp_status', 'OTLP span status must be an object.', context);
    return undefined;
  }
  warnUnknownFields(status, OTLP_STATUS_FIELDS, warnings, context);
  return dropUndefined({
    code: normalizeStatusCode(status.code, warnings, context),
    message: stringValue(status.message),
  });
}

function normalizeStatusCode(
  value: unknown,
  warnings: WarningSink,
  context: WarningContext,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value.replace(/^STATUS_CODE_/, '');
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value === 0) return 'UNSET';
    if (value === 1) return 'OK';
    if (value === 2) return 'ERROR';
    addWarning(
      warnings,
      'unknown_status_code',
      `Unknown OTLP status code ${value} was preserved as a string.`,
      context,
    );
    return String(value);
  }
  addWarning(
    warnings,
    'malformed_status_code',
    'OTLP status code was not a string or integer.',
    context,
  );
  return undefined;
}

function normalizeUnixNano(
  value: unknown,
  field: string,
  warnings: WarningSink,
  context: WarningContext,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    if (!/^\d+$/.test(value)) {
      addWarning(
        warnings,
        'malformed_unix_nano',
        `OTLP ${field} was not an unsigned integer string.`,
        context,
      );
    }
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  addWarning(warnings, 'malformed_unix_nano', `OTLP ${field} was not a string or number.`, context);
  return undefined;
}

function firstRootSpanId(spans: readonly NormalizedOtlpSpan[]): string | undefined {
  const spanIds = new Set(spans.map((span) => span.span_id));
  return (
    spans.find(
      (span) =>
        !span.parent_span_id ||
        (typeof span.parent_span_id === 'string' && !spanIds.has(span.parent_span_id)),
    )?.span_id ?? spans[0]?.span_id
  );
}

function singleDistinctRecord(
  records: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  if (records.length === 0) {
    return undefined;
  }
  const unique = new Map(records.map((record) => [stableRecordKey(record), record]));
  return unique.size === 1 ? [...unique.values()][0] : undefined;
}

function stableRecordKey(record: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

function firstString(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function integerOrString(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) ? numberValue : value;
  }
  return String(value ?? '');
}

function numberOrString(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  return String(value ?? '');
}

function warnUnknownFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  warnings: WarningSink,
  context: WarningContext,
): void {
  const unknownFields = Object.keys(record).filter((key) => !allowed.has(key));
  for (const field of unknownFields) {
    addWarning(
      warnings,
      'unknown_otlp_field',
      `Unknown OTLP ${context.rawKind ?? 'object'} field "${field}" was ignored.`,
      { ...context, details: { ...(context.details ?? {}), field } },
    );
  }
}

function addWarning(
  warnings: WarningSink,
  code: string,
  message: string,
  context: WarningContext = {},
): void {
  warnings.push(
    dropUndefined({
      code,
      severity: 'warning',
      span_id: context.spanId,
      source_ref:
        context.path || context.rawKind
          ? dropUndefined({
              path: context.path,
              raw_kind: context.rawKind,
              span_id: context.spanId,
            })
          : undefined,
      message,
      details: context.details,
    }) as TraceSessionConversionWarning,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isPrimitive(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
