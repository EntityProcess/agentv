/**
 * Transcript replay source for provider-agnostic recorded trajectory cassettes.
 *
 * Imported coding-agent logs are normalized into AgentV transcript JSONL first.
 * The replay provider can then substitute those recorded trajectories for a
 * live target by matching the current eval case to transcript `test_id` and
 * `source_target`, while graders run fresh over AgentV Message[] output.
 */

import {
  type TranscriptReplayEntry,
  groupTranscriptJsonLines,
  readTranscriptJsonl,
} from '../import/types.js';
import { deriveSkillCallsFromMessages, skillCallMetadata } from './providers/skill-calls.js';
import type { ProviderResponse } from './providers/types.js';
import type { ReplayFixtureLookup } from './replay-fixtures.js';

export interface TranscriptReplayRecord {
  readonly entry: TranscriptReplayEntry;
  readonly sourcePath: string;
}

export async function readTranscriptReplayRecords(
  sourcePath: string,
): Promise<readonly TranscriptReplayRecord[]> {
  const lines = await readTranscriptJsonl(sourcePath);
  return groupTranscriptJsonLines(lines).map((entry) => ({ entry, sourcePath }));
}

export function findTranscriptReplayRecord(
  records: readonly TranscriptReplayRecord[],
  lookup: ReplayFixtureLookup,
): TranscriptReplayRecord {
  const matches = records.filter((record) => transcriptRecordMatches(record.entry, lookup));
  if (matches.length === 1) {
    return matches[0];
  }

  const key = `test_id=${lookup.testId} source_target=${lookup.sourceTarget}`;
  if (matches.length === 0) {
    throw new Error(`Transcript replay lookup found no record for ${key}`);
  }
  throw new Error(`Transcript replay lookup found ${matches.length} duplicate records for ${key}`);
}

export function transcriptReplayRecordToProviderResponse(
  record: TranscriptReplayRecord,
): ProviderResponse {
  const entry = record.entry;
  return {
    output: entry.messages,
    metadata: skillCallMetadata(deriveSkillCallsFromMessages(entry.messages)),
    tokenUsage: entry.tokenUsage,
    durationMs: entry.durationMs,
    costUsd: entry.costUsd ?? undefined,
    startTime: entry.source.startedAt,
    raw: {
      replay_transcript: dropUndefined({
        source_path: record.sourcePath,
        test_id: entry.testId,
        target: entry.target,
        source_provider: entry.source.provider,
        source_session_id: entry.source.sessionId,
        source_kind: entry.source.kind,
        source_format: entry.source.format,
        source_model: entry.source.model,
        source_cwd: entry.source.cwd,
        source_metadata: entry.source.metadata,
      }),
    },
  };
}

function transcriptRecordMatches(
  entry: TranscriptReplayEntry,
  lookup: ReplayFixtureLookup,
): boolean {
  return entry.testId === lookup.testId && entry.target === lookup.sourceTarget;
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
