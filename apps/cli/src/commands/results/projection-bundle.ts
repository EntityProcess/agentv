/**
 * Vendor-neutral projection bundle for completed AgentV runs.
 *
 * This file builds a deterministic, local JSON contract that adapter workers
 * can consume without calling vendor SDKs. The bundle keeps AgentV artifacts as
 * the source of truth, includes metadata-only OpenInference-shaped spans by
 * default, and requires explicit opt-in before raw prompt/output/tool payloads
 * are copied into the bundle.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type EvaluationResult,
  type ExportDuplicatePolicy,
  type IndexArtifactEntry,
  type ProjectionIdentityWire,
  type TraceEnvelopeCaptureWire,
  type TraceEnvelopeConversionWarningWire,
  type TraceEnvelopeScoreWire,
  type TraceEnvelopeWire,
  buildResultIndexArtifact,
  buildTraceEnvelopeFromEvaluationResult,
  toTraceEnvelopeWire,
} from '@agentv/core';

export const PROJECTION_BUNDLE_FILENAME = 'projection_bundle.json';
export const PROJECTION_BUNDLE_SCHEMA_VERSION = 'agentv.projection_bundle.v1';

type JsonRecord = Record<string, unknown>;

export interface ProjectionBundle {
  readonly schema_version: typeof PROJECTION_BUNDLE_SCHEMA_VERSION;
  readonly bundle_id: string;
  readonly created_at: string;
  readonly source: {
    readonly kind: 'agentv_run';
    readonly path: string;
    readonly run_id: string;
    readonly result_count: number;
  };
  readonly content_policy: {
    readonly raw_content: 'excluded' | 'included';
    readonly raw_content_opt_in: boolean;
    readonly default_capture: 'metadata' | 'full';
    readonly backend_anonymizer_boundary: 'adapter';
  };
  readonly capture_summary: TraceEnvelopeCaptureWire;
  readonly entries: readonly ProjectionBundleEntry[];
  readonly conversion_warnings?: readonly TraceEnvelopeConversionWarningWire[];
}

export interface ProjectionBundleEntry {
  readonly projection_id: string;
  readonly projection_identity: ProjectionIdentityWire;
  readonly eval: TraceEnvelopeWire['eval'];
  readonly artifact_refs: ProjectionBundleArtifactRefs;
  readonly trace: {
    readonly format: TraceEnvelopeWire['trace']['format'];
    readonly trace_id: string;
    readonly root_span_id: string;
    readonly span_count: number;
    readonly envelope_ref?: string;
  };
  readonly trace_envelope: TraceEnvelopeWire;
  readonly feedback: {
    readonly source: 'agentv_grading_artifacts';
    readonly result_score: number;
    readonly execution_status?: string;
    readonly grading_path?: string;
    readonly timing_path?: string;
    readonly assertion_count: number;
    readonly scores?: readonly TraceEnvelopeScoreWire[];
  };
  readonly capture: TraceEnvelopeCaptureWire;
  readonly conversion_warnings?: readonly TraceEnvelopeConversionWarningWire[];
  readonly raw_content?: {
    readonly input?: unknown;
    readonly output?: string;
    readonly trace_messages?: unknown;
  };
}

export type ProjectionBundleArtifactRefs = Partial<
  Pick<
    IndexArtifactEntry,
    | 'artifact_dir'
    | 'summary_path'
    | 'grading_path'
    | 'timing_path'
    | 'input_path'
    | 'output_path'
    | 'answer_path'
    | 'transcript_path'
    | 'metrics_path'
    | 'task_dir'
    | 'eval_path'
    | 'targets_path'
    | 'files_path'
    | 'graders_path'
  > & { readonly trace_path: string }
> & {
  readonly status: 'planned_export' | 'emitted';
};

export interface BuildProjectionBundleOptions {
  readonly sourceFile: string;
  readonly runId: string;
  readonly cwd?: string;
  readonly includeRawContent?: boolean;
  readonly duplicatePolicy?: ExportDuplicatePolicy;
  readonly artifactRefStatus?: ProjectionBundleArtifactRefs['status'];
  readonly indexRecords?: readonly IndexArtifactEntry[];
}

function dropUndefined<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function toPortablePath(filePath: string, cwd?: string): string {
  const absolutePath = path.resolve(filePath);
  const absoluteCwd = path.resolve(cwd ?? process.cwd());
  const relative = path.relative(absoluteCwd, absolutePath);
  const portable =
    relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : absolutePath;
  return portable.split(path.sep).join('/');
}

function stableDate(value: string | undefined): Date {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : new Date(0);
}

function bundleCreatedAt(results: readonly EvaluationResult[]): string {
  const timestamps = results
    .map((result) => stableDate(result.timestamp).toISOString())
    .sort((a, b) => a.localeCompare(b));
  return timestamps[0] ?? new Date(0).toISOString();
}

function shortHash(parts: readonly string[], length = 20): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, length);
}

function tracePathFor(indexEntry: IndexArtifactEntry): string | undefined {
  return (
    indexEntry.trace_path ??
    (indexEntry.artifact_dir ? path.posix.join(indexEntry.artifact_dir, 'trace.json') : undefined)
  );
}

function artifactRefs(
  indexEntry: IndexArtifactEntry,
  options: {
    readonly includeRawContent: boolean;
    readonly status: ProjectionBundleArtifactRefs['status'];
  },
): ProjectionBundleArtifactRefs {
  const metadataRefs = dropUndefined({
    status: options.status,
    timing_path: indexEntry.timing_path,
  });

  if (!options.includeRawContent) {
    return metadataRefs;
  }

  return dropUndefined({
    ...metadataRefs,
    artifact_dir: indexEntry.artifact_dir,
    summary_path: indexEntry.summary_path,
    grading_path: indexEntry.grading_path,
    input_path: indexEntry.input_path,
    output_path: indexEntry.output_path,
    answer_path: indexEntry.answer_path,
    transcript_path: indexEntry.transcript_path,
    metrics_path: indexEntry.metrics_path,
    trace_path: tracePathFor(indexEntry),
    task_dir: indexEntry.task_dir,
    eval_path: indexEntry.eval_path,
    targets_path: indexEntry.targets_path,
    files_path: indexEntry.files_path,
    graders_path: indexEntry.graders_path,
  });
}

function removeTranscriptMessageMetadata(envelope: TraceEnvelopeWire): TraceEnvelopeWire {
  return {
    ...envelope,
    trace: {
      ...envelope.trace,
      spans: envelope.trace.spans.map((span) => ({
        ...span,
        events: span.events?.map((event) => {
          const transcriptMessage = event.attributes?.['agentv.transcript.message'];
          if (
            !transcriptMessage ||
            typeof transcriptMessage !== 'object' ||
            Array.isArray(transcriptMessage)
          ) {
            return event;
          }
          const { metadata: _metadata, ...safeMessage } = transcriptMessage as JsonRecord;
          return {
            ...event,
            attributes: {
              ...event.attributes,
              'agentv.transcript.message': safeMessage,
            },
          };
        }),
      })),
    },
  };
}

function safeEnvelope(
  envelope: TraceEnvelopeWire,
  options: { includeRawContent: boolean },
): TraceEnvelopeWire {
  if (options.includeRawContent) {
    return envelope;
  }

  const withoutRawEvidence = removeTranscriptMessageMetadata({
    ...envelope,
    source: {
      ...envelope.source,
      metadata: undefined,
    },
    artifacts: undefined,
    scores: envelope.scores?.map(({ evidence: _evidence, ...score }) => score),
  });

  return JSON.parse(JSON.stringify(withoutRawEvidence)) as TraceEnvelopeWire;
}

function safeScores(
  scores: readonly TraceEnvelopeScoreWire[] | undefined,
  options: { includeRawContent: boolean },
): readonly TraceEnvelopeScoreWire[] | undefined {
  if (!scores) {
    return undefined;
  }
  return options.includeRawContent
    ? scores
    : scores.map(({ evidence: _evidence, ...score }) => score);
}

function captureOptions(includeRawContent: boolean) {
  return includeRawContent
    ? { content: 'full' as const, redactionLevel: 'none' as const, redactedFields: [] }
    : undefined;
}

function rawContent(result: EvaluationResult): ProjectionBundleEntry['raw_content'] {
  return dropUndefined({
    input: result.input,
    output: result.output,
    trace_messages: result.trace.messages,
  });
}

function buildEntry(
  result: EvaluationResult,
  options: BuildProjectionBundleOptions,
  indexRecord?: IndexArtifactEntry,
): ProjectionBundleEntry {
  const includeRawContent = options.includeRawContent ?? false;
  const sourcePath = toPortablePath(options.sourceFile, options.cwd);
  const plannedIndexEntry = buildResultIndexArtifact(result);
  const envelope = buildTraceEnvelopeFromEvaluationResult(result, {
    evalPath: sourcePath,
    runId: options.runId,
    source: { kind: 'agentv_run', path: sourcePath, format: 'agentv_result' },
    artifacts: {
      trace_path: tracePathFor(indexRecord ?? plannedIndexEntry),
      answer_path: result.output.length > 0 ? 'outputs/answer.md' : undefined,
    },
    duplicatePolicy: options.duplicatePolicy,
    capture: captureOptions(includeRawContent),
    now: () => stableDate(result.timestamp),
  });
  const projectionIdentity = envelope.projectionIdentity;
  if (!projectionIdentity) {
    throw new Error(`Result ${result.testId ?? 'unknown'} is missing projection identity`);
  }

  const indexEntry =
    indexRecord ??
    buildResultIndexArtifact(result, undefined, {
      projectionIdentity,
      duplicatePolicy: options.duplicatePolicy,
    });
  const refs = artifactRefs(indexEntry, {
    includeRawContent,
    status: options.artifactRefStatus ?? 'planned_export',
  });
  const safeEnvelopeWire = safeEnvelope(toTraceEnvelopeWire(envelope), { includeRawContent });
  const projectionIdentityWire =
    indexEntry.projection_identity ?? safeEnvelopeWire.projection_identity;
  if (!projectionIdentityWire) {
    throw new Error(`Result ${result.testId ?? 'unknown'} is missing projection identity`);
  }
  const envelopeWire = {
    ...safeEnvelopeWire,
    projection_identity: projectionIdentityWire,
  };
  const scores = safeScores(envelopeWire.scores, { includeRawContent });

  const feedback: ProjectionBundleEntry['feedback'] = dropUndefined({
    source: 'agentv_grading_artifacts',
    result_score: result.score,
    execution_status: result.executionStatus,
    grading_path: refs.grading_path,
    timing_path: refs.timing_path,
    assertion_count: result.assertions?.length ?? 0,
    scores,
  });

  return {
    projection_id: projectionIdentity.id,
    projection_identity: projectionIdentityWire,
    eval: envelopeWire.eval,
    artifact_refs: refs,
    trace: dropUndefined({
      format: envelopeWire.trace.format,
      trace_id: envelopeWire.trace.trace_id,
      root_span_id: envelopeWire.trace.root_span_id,
      span_count: envelopeWire.trace.spans.length,
      envelope_ref: refs.trace_path,
    }),
    trace_envelope: envelopeWire,
    feedback,
    capture: envelopeWire.capture,
    ...(envelopeWire.conversion_warnings
      ? { conversion_warnings: envelopeWire.conversion_warnings }
      : {}),
    ...(includeRawContent ? { raw_content: rawContent(result) } : {}),
  };
}

export function buildProjectionBundle(
  results: readonly EvaluationResult[],
  options: BuildProjectionBundleOptions,
): ProjectionBundle {
  if (results.length === 0) {
    throw new Error(`No results found in ${options.sourceFile}`);
  }

  const entries = results.map((result, index) =>
    buildEntry(result, options, options.indexRecords?.[index]),
  );
  const includeRawContent = options.includeRawContent ?? false;
  const artifactRefStatus = options.artifactRefStatus ?? 'planned_export';
  const conversionWarnings = entries.flatMap((entry) => entry.conversion_warnings ?? []);
  const bundleId = `projection-bundle-${shortHash([
    PROJECTION_BUNDLE_SCHEMA_VERSION,
    toPortablePath(options.sourceFile, options.cwd),
    options.runId,
    artifactRefStatus,
    includeRawContent ? 'raw' : 'metadata',
    ...entries.map((entry) => entry.projection_id),
  ])}`;

  return {
    schema_version: PROJECTION_BUNDLE_SCHEMA_VERSION,
    bundle_id: bundleId,
    created_at: bundleCreatedAt(results),
    source: {
      kind: 'agentv_run',
      path: toPortablePath(options.sourceFile, options.cwd),
      run_id: options.runId,
      result_count: results.length,
    },
    content_policy: {
      raw_content: includeRawContent ? 'included' : 'excluded',
      raw_content_opt_in: includeRawContent,
      default_capture: includeRawContent ? 'full' : 'metadata',
      backend_anonymizer_boundary: 'adapter',
    },
    capture_summary: entries[0]?.capture ?? {
      content: includeRawContent ? 'full' : 'metadata',
      redaction_level: includeRawContent ? 'none' : 'partial',
    },
    entries,
    ...(conversionWarnings.length > 0 ? { conversion_warnings: conversionWarnings } : {}),
  };
}

export function serializeProjectionBundle(bundle: ProjectionBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export async function writeProjectionBundle(
  bundle: ProjectionBundle,
  outputDir: string,
): Promise<string> {
  const bundlePath = path.join(outputDir, PROJECTION_BUNDLE_FILENAME);
  await mkdir(outputDir, { recursive: true });
  await writeFile(bundlePath, serializeProjectionBundle(bundle), 'utf8');
  return bundlePath;
}
