/**
 * Core types for the transcript import pipeline.
 *
 * A TranscriptEntry represents a single event in a parsed agent session
 * transcript (user message, assistant response, tool call, etc.).
 *
 * A TranscriptSource describes where a transcript came from (provider,
 * session ID, file path, etc.).
 */

import { readFile } from 'node:fs/promises';

import type { Message, ProviderTokenUsage } from '../evaluation/providers/types.js';

/**
 * A parsed transcript: ordered messages plus session metadata.
 */
export interface TranscriptEntry {
  readonly messages: Message[];
  readonly source: TranscriptSource;
  readonly tokenUsage?: ProviderTokenUsage;
  readonly durationMs?: number;
  readonly costUsd?: number | null;
}

/**
 * Metadata describing the origin of a transcript.
 */
export interface TranscriptSource {
  readonly provider: string;
  readonly sessionId: string;
  readonly projectPath?: string;
  readonly startedAt?: string;
  readonly model?: string;
}

/**
 * Read a JSONL transcript file and return its raw text.
 * Throws if the file does not exist or cannot be read.
 */
export async function readTranscriptFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}
