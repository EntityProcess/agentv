/**
 * Stable external identity for AgentV-owned export projections.
 *
 * Adapter workers use this model to decide whether a completed AgentV run
 * projection should update, skip, or fail on retry. The identity is derived
 * only from AgentV-owned dimensions and is serialized with snake_case fields so
 * local bundles and future SDK adapters share one contract.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PROJECTION_IDENTITY_SCHEMA_VERSION = 'agentv.projection_identity.v1' as const;

export const EXPORT_DUPLICATE_POLICY_VALUES = ['skip', 'update', 'error'] as const;

export type ExportDuplicatePolicy = (typeof EXPORT_DUPLICATE_POLICY_VALUES)[number];

const PROJECTION_IDENTITY_ISSUE_SEVERITY_VALUES = ['warning', 'error'] as const;

export type ProjectionIdentityIssueSeverity =
  (typeof PROJECTION_IDENTITY_ISSUE_SEVERITY_VALUES)[number];

export interface ProjectionIdentityIssue {
  readonly code: string;
  readonly severity: ProjectionIdentityIssueSeverity;
  readonly field?: string;
  readonly message: string;
}

export interface ProjectionIdentityDimensions {
  readonly runId: string;
  readonly suite?: string;
  readonly evalPath?: string;
  readonly testId: string;
  readonly target: string;
  readonly sourceTarget: string;
  readonly attempt: number;
  readonly variant: string | null;
  readonly envelopeId: string;
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly projectionFormat: string;
  readonly projectionVersion: string;
}

export interface ProjectionIdentityInput {
  readonly runId?: string;
  readonly suite?: string;
  readonly evalPath?: string;
  readonly testId?: string;
  readonly target?: string;
  readonly sourceTarget?: string;
  readonly attempt?: number;
  readonly variant?: string | null;
  readonly envelopeId?: string;
  readonly traceId?: string;
  readonly rootSpanId?: string;
  readonly projectionFormat?: string;
  readonly projectionVersion?: string;
}

export interface ProjectionIdentity {
  readonly schemaVersion: typeof PROJECTION_IDENTITY_SCHEMA_VERSION;
  readonly id: string;
  readonly key: string;
  readonly dimensions: ProjectionIdentityDimensions;
  readonly issues?: readonly ProjectionIdentityIssue[];
}

export class ProjectionIdentityError extends Error {
  readonly issues: readonly ProjectionIdentityIssue[];

  constructor(issues: readonly ProjectionIdentityIssue[]) {
    super(
      `Projection identity is missing required fields: ${issues.map((i) => i.field).join(', ')}`,
    );
    this.name = 'ProjectionIdentityError';
    this.issues = issues;
  }
}

const REQUIRED_STRING_FIELDS = [
  'runId',
  'testId',
  'target',
  'sourceTarget',
  'envelopeId',
  'traceId',
  'rootSpanId',
  'projectionFormat',
  'projectionVersion',
] as const;

type RequiredStringField = (typeof REQUIRED_STRING_FIELDS)[number];

const DIMENSION_KEY_ORDER = [
  'projection_format',
  'projection_version',
  'run_id',
  'suite',
  'eval_path',
  'test_id',
  'target',
  'source_target',
  'attempt',
  'variant',
  'envelope_id',
  'trace_id',
  'root_span_id',
] as const;

function normalizedString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeAttempt(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ProjectionIdentityError([
      {
        code: 'invalid_attempt',
        severity: 'error',
        field: 'attempt',
        message: 'Projection identity attempt must be a non-negative integer.',
      },
    ]);
  }
  return value;
}

function normalizeVariant(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizedString(value) ?? null;
}

function missingRequiredIssue(field: RequiredStringField): ProjectionIdentityIssue {
  return {
    code: 'missing_identity_field',
    severity: 'error',
    field,
    message: `Projection identity requires ${field}.`,
  };
}

function encodeKeyValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '~';
  }
  return encodeURIComponent(String(value));
}

function dimensionEntries(
  dimensions: ProjectionIdentityDimensions,
): Record<string, string | number | null> {
  return {
    projection_format: dimensions.projectionFormat,
    projection_version: dimensions.projectionVersion,
    run_id: dimensions.runId,
    suite: dimensions.suite ?? null,
    eval_path: dimensions.evalPath ?? null,
    test_id: dimensions.testId,
    target: dimensions.target,
    source_target: dimensions.sourceTarget,
    attempt: dimensions.attempt,
    variant: dimensions.variant,
    envelope_id: dimensions.envelopeId,
    trace_id: dimensions.traceId,
    root_span_id: dimensions.rootSpanId,
  };
}

export function buildProjectionIdentityKey(dimensions: ProjectionIdentityDimensions): string {
  const entries = dimensionEntries(dimensions);
  const body = DIMENSION_KEY_ORDER.map((key) => `${key}=${encodeKeyValue(entries[key])}`).join('|');
  return `${PROJECTION_IDENTITY_SCHEMA_VERSION}:${body}`;
}

export function buildProjectionIdentity(
  input: ProjectionIdentityInput,
  options?: { missingFieldPolicy?: 'error' | 'warn' },
): ProjectionIdentity {
  const values = {
    runId: normalizedString(input.runId),
    suite: normalizedString(input.suite),
    evalPath: normalizedString(input.evalPath),
    testId: normalizedString(input.testId),
    target: normalizedString(input.target),
    sourceTarget: normalizedString(input.sourceTarget) ?? normalizedString(input.target),
    envelopeId: normalizedString(input.envelopeId),
    traceId: normalizedString(input.traceId),
    rootSpanId: normalizedString(input.rootSpanId),
    projectionFormat: normalizedString(input.projectionFormat),
    projectionVersion: normalizedString(input.projectionVersion),
  };

  const issues: ProjectionIdentityIssue[] = [];
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!values[field]) {
      issues.push(missingRequiredIssue(field));
    }
  }
  if (!values.suite && !values.evalPath) {
    issues.push({
      code: 'missing_suite_or_eval_path',
      severity: 'warning',
      field: 'suite/evalPath',
      message:
        'Projection identity is more portable when at least one of suite or evalPath is present.',
    });
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0 && (options?.missingFieldPolicy ?? 'error') === 'error') {
    throw new ProjectionIdentityError(errors);
  }

  const dimensions: ProjectionIdentityDimensions = {
    runId: values.runId ?? 'unknown',
    suite: values.suite,
    evalPath: values.evalPath,
    testId: values.testId ?? 'unknown',
    target: values.target ?? 'unknown',
    sourceTarget: values.sourceTarget ?? 'unknown',
    attempt: normalizeAttempt(input.attempt),
    variant: normalizeVariant(input.variant),
    envelopeId: values.envelopeId ?? 'unknown',
    traceId: values.traceId ?? 'unknown',
    rootSpanId: values.rootSpanId ?? 'unknown',
    projectionFormat: values.projectionFormat ?? 'unknown',
    projectionVersion: values.projectionVersion ?? 'unknown',
  };
  const key = buildProjectionIdentityKey(dimensions);
  const digest = createHash('sha256').update(key).digest('hex');

  return {
    schemaVersion: PROJECTION_IDENTITY_SCHEMA_VERSION,
    id: `agentv-prj-${digest.slice(0, 32)}`,
    key,
    dimensions,
    issues: issues.length > 0 ? issues : undefined,
  };
}

export const ProjectionIdentityIssueWireSchema = z
  .object({
    code: z.string(),
    severity: z.enum(PROJECTION_IDENTITY_ISSUE_SEVERITY_VALUES),
    field: z.string().optional(),
    message: z.string(),
  })
  .strict();

export const ProjectionIdentityDimensionsWireSchema = z
  .object({
    run_id: z.string(),
    suite: z.string().optional(),
    eval_path: z.string().optional(),
    test_id: z.string(),
    target: z.string(),
    source_target: z.string(),
    attempt: z.number().int().nonnegative(),
    variant: z.string().nullable(),
    envelope_id: z.string(),
    trace_id: z.string(),
    root_span_id: z.string(),
    projection_format: z.string(),
    projection_version: z.string(),
  })
  .strict();

export const ProjectionIdentityWireSchema = z
  .object({
    schema_version: z.literal(PROJECTION_IDENTITY_SCHEMA_VERSION),
    id: z.string(),
    key: z.string(),
    dimensions: ProjectionIdentityDimensionsWireSchema,
    issues: z.array(ProjectionIdentityIssueWireSchema).optional(),
  })
  .strict();

export type ProjectionIdentityIssueWire = z.infer<typeof ProjectionIdentityIssueWireSchema>;
export type ProjectionIdentityDimensionsWire = z.infer<
  typeof ProjectionIdentityDimensionsWireSchema
>;
export type ProjectionIdentityWire = z.infer<typeof ProjectionIdentityWireSchema>;

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function toProjectionIdentityIssueWire(
  issue: ProjectionIdentityIssue,
): ProjectionIdentityIssueWire {
  return ProjectionIdentityIssueWireSchema.parse(
    dropUndefined({
      code: issue.code,
      severity: issue.severity,
      field: issue.field,
      message: issue.message,
    }),
  );
}

export function fromProjectionIdentityIssueWire(
  issue: ProjectionIdentityIssueWire,
): ProjectionIdentityIssue {
  return {
    code: issue.code,
    severity: issue.severity,
    field: issue.field,
    message: issue.message,
  };
}

export function toProjectionIdentityWire(identity: ProjectionIdentity): ProjectionIdentityWire {
  return ProjectionIdentityWireSchema.parse(
    dropUndefined({
      schema_version: identity.schemaVersion,
      id: identity.id,
      key: identity.key,
      dimensions: {
        run_id: identity.dimensions.runId,
        suite: identity.dimensions.suite,
        eval_path: identity.dimensions.evalPath,
        test_id: identity.dimensions.testId,
        target: identity.dimensions.target,
        source_target: identity.dimensions.sourceTarget,
        attempt: identity.dimensions.attempt,
        variant: identity.dimensions.variant,
        envelope_id: identity.dimensions.envelopeId,
        trace_id: identity.dimensions.traceId,
        root_span_id: identity.dimensions.rootSpanId,
        projection_format: identity.dimensions.projectionFormat,
        projection_version: identity.dimensions.projectionVersion,
      },
      issues: identity.issues?.map(toProjectionIdentityIssueWire),
    }),
  );
}

export function fromProjectionIdentityWire(input: unknown): ProjectionIdentity {
  const wire = ProjectionIdentityWireSchema.parse(input);
  return {
    schemaVersion: wire.schema_version,
    id: wire.id,
    key: wire.key,
    dimensions: {
      runId: wire.dimensions.run_id,
      suite: wire.dimensions.suite,
      evalPath: wire.dimensions.eval_path,
      testId: wire.dimensions.test_id,
      target: wire.dimensions.target,
      sourceTarget: wire.dimensions.source_target,
      attempt: wire.dimensions.attempt,
      variant: wire.dimensions.variant,
      envelopeId: wire.dimensions.envelope_id,
      traceId: wire.dimensions.trace_id,
      rootSpanId: wire.dimensions.root_span_id,
      projectionFormat: wire.dimensions.projection_format,
      projectionVersion: wire.dimensions.projection_version,
    },
    issues: wire.issues?.map(fromProjectionIdentityIssueWire),
  };
}
