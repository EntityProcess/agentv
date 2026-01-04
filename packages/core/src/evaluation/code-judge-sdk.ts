import { readFileSync } from 'node:fs';

import { toCamelCaseDeep } from './case-conversion.js';
import type { OutputMessage } from './providers/types.js';
import type { TraceSummary } from './trace.js';
import type { JsonObject, TestMessage } from './types.js';

/**
 * Payload received by code judges via stdin.
 * All properties use camelCase for TypeScript ergonomics.
 */
export interface CodeJudgePayload {
  readonly question: string;
  readonly expectedOutcome: string;
  readonly expectedMessages: readonly JsonObject[];
  readonly referenceAnswer?: string;
  readonly candidateAnswer: string;
  readonly outputMessages?: readonly OutputMessage[] | null;
  readonly guidelineFiles: readonly string[];
  readonly inputFiles: readonly string[];
  readonly inputMessages: readonly TestMessage[];
  readonly traceSummary?: TraceSummary | null;
  readonly config?: JsonObject | null;
}

/**
 * Parse stdin JSON (snake_case) into typed camelCase object.
 * Use this in TypeScript code judges to get type-safe, idiomatic input.
 */
export function parseCodeJudgePayload(payload: string): CodeJudgePayload {
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  return toCamelCaseDeep(parsed) as CodeJudgePayload;
}

/**
 * Convenience helper that reads stdin and parses it.
 * Equivalent to: parseCodeJudgePayload(readFileSync(0, 'utf8'))
 */
export function readCodeJudgePayload(): CodeJudgePayload {
  const stdin = readFileSync(0, 'utf8');
  return parseCodeJudgePayload(stdin);
}
