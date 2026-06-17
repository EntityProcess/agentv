/**
 * Execution-trace replay source for target-output substitution.
 *
 * This module lets the replay provider read `agentv.execution_trace.v1`
 * artifacts as the target-output source. Lookup uses the same replay identity
 * dimensions as JSONL fixtures, then projects the matched artifact to the
 * existing ProviderResponse shape with traceEnvelopeToMessages(). Opaque
 * message, tool, provider, and source payloads stay inside the execution trace
 * projection without recursive key conversion.
 */

import { readFile } from 'node:fs/promises';
import type { ProviderResponse } from './providers/types.js';
import {
  type ReplayFixtureLookup,
  type ReplayLookupIdentity,
  formatReplayLookupKey,
  replayLookupIdentityMatches,
} from './replay-fixtures.js';
import {
  type TraceEnvelope,
  fromTraceEnvelopeWire,
  toTraceEnvelopeWire,
  traceEnvelopeToMessages,
  traceEnvelopeToTraceSummary,
} from './trace-envelope.js';

export interface TraceEnvelopeReplayRecord {
  readonly envelope: TraceEnvelope;
  readonly sourcePath: string;
  readonly lineNumber?: number;
}

export async function readTraceEnvelopeReplayRecords(
  sourcePath: string,
): Promise<readonly TraceEnvelopeReplayRecord[]> {
  let raw: string;
  try {
    raw = await readFile(sourcePath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Execution trace replay source not found or unreadable: ${sourcePath}: ${reason}`,
    );
  }

  const documents = parseTraceEnvelopeDocuments(raw, sourcePath);
  return documents.map((document) => ({
    envelope: parseTraceEnvelopeDocument(document.value, sourcePath, document.lineNumber),
    sourcePath,
    lineNumber: document.lineNumber,
  }));
}

export function findTraceEnvelopeReplayRecord(
  records: readonly TraceEnvelopeReplayRecord[],
  lookup: ReplayFixtureLookup,
): TraceEnvelopeReplayRecord {
  const matches = records.filter((record) =>
    replayLookupIdentityMatches(traceEnvelopeReplayIdentity(record.envelope), lookup),
  );
  if (matches.length === 1) {
    return matches[0];
  }

  const key = formatReplayLookupKey(lookup);
  if (matches.length === 0) {
    throw new Error(`Execution trace replay lookup found no record for ${key}`);
  }
  throw new Error(
    `Execution trace replay lookup found ${matches.length} duplicate records for ${key}`,
  );
}

export function traceEnvelopeReplayRecordToProviderResponse(
  record: TraceEnvelopeReplayRecord,
): ProviderResponse {
  const output = traceEnvelopeToMessages(record.envelope);
  assertReplayableMessages(output, record);
  const summary = traceEnvelopeToTraceSummary(record.envelope);
  const identity = traceEnvelopeReplayIdentity(record.envelope);
  const wire = toTraceEnvelopeWire(record.envelope);

  return {
    output,
    tokenUsage: summary.tokenUsage,
    costUsd: summary.costUsd,
    durationMs: summary.durationMs,
    startTime: summary.startTime,
    endTime: summary.endTime,
    raw: {
      replay_execution_trace: dropUndefined({
        artifact_id: record.envelope.artifactId,
        source_path: record.sourcePath,
        line_number: record.lineNumber,
        suite: identity.suite,
        eval_path: identity.evalPath,
        test_id: identity.testId,
        target: record.envelope.eval.target,
        source_target: identity.sourceTarget,
        attempt: identity.attempt,
        variant: identity.variant ?? undefined,
        trace_id: record.envelope.trace.traceId,
        root_span_id: record.envelope.trace.rootSpanId,
        source: wire.source,
        capture: wire.capture,
        artifacts: wire.artifacts,
        conversion_warnings: wire.conversion_warnings,
      }),
    },
  };
}

function parseTraceEnvelopeDocuments(
  raw: string,
  sourcePath: string,
): readonly { readonly value: unknown; readonly lineNumber?: number }[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((value) => ({ value }));
    }
    return [{ value: parsed }];
  } catch {
    const documents: { value: unknown; lineNumber: number }[] = [];
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) {
        continue;
      }
      try {
        documents.push({ value: JSON.parse(line), lineNumber: i + 1 });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid execution trace JSONL at ${sourcePath}:${i + 1}: ${reason}`);
      }
    }
    return documents;
  }
}

function parseTraceEnvelopeDocument(
  value: unknown,
  sourcePath: string,
  lineNumber: number | undefined,
): TraceEnvelope {
  try {
    return fromTraceEnvelopeWire(value);
  } catch (error) {
    const location = lineNumber === undefined ? sourcePath : `${sourcePath}:${lineNumber}`;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid execution trace replay record at ${location}: ${reason}`);
  }
}

function traceEnvelopeReplayIdentity(envelope: TraceEnvelope): ReplayLookupIdentity {
  const lookupKey = envelope.replay?.lookupKey;
  return {
    suite: envelope.eval.suite ?? lookupKeyString(lookupKey, 'suite'),
    evalPath: envelope.eval.evalPath ?? lookupKeyString(lookupKey, 'eval_path'),
    testId: envelope.eval.testId,
    sourceTarget:
      envelope.eval.sourceTarget ??
      lookupKeyString(lookupKey, 'source_target') ??
      envelope.eval.target,
    attempt: envelope.eval.attempt ?? lookupKeyNumber(lookupKey, 'attempt') ?? 0,
    variant: envelope.eval.variant ?? lookupKeyString(lookupKey, 'variant') ?? undefined,
  };
}

function lookupKeyString(
  lookupKey: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = lookupKey?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function lookupKeyNumber(
  lookupKey: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = lookupKey?.[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function assertReplayableMessages(
  output: readonly { readonly role: string; readonly content?: unknown }[],
  record: TraceEnvelopeReplayRecord,
): void {
  if (output.length === 0) {
    throw new Error(
      `Execution trace replay source ${formatRecordLocation(record)} cannot project to provider Message[]: no chat spans found`,
    );
  }

  const lastAssistant = [...output].reverse().find((message) => message.role === 'assistant');
  if (!lastAssistant || lastAssistant.content === undefined) {
    throw new Error(
      `Execution trace replay source ${formatRecordLocation(record)} is missing assistant output content; replay requires a full-content execution trace before grading`,
    );
  }
}

function formatRecordLocation(record: TraceEnvelopeReplayRecord): string {
  return record.lineNumber === undefined
    ? record.sourcePath
    : `${record.sourcePath}:${record.lineNumber}`;
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
