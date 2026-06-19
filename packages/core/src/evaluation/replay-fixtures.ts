/**
 * Replay fixture database for target-output substitution.
 *
 * Replay fixtures are strict JSONL records that store target outputs from an
 * expensive live run. A replay target later looks up the exact row by suite or
 * eval identity, test id, source target, attempt, and variant, then returns the
 * recorded ProviderResponse while graders run fresh.
 *
 * To add fields to the wire format: add snake_case to ReplayFixtureWireSchema,
 * translate it in fromWireRecord()/toWireRecord(), and keep TypeScript callers
 * on camelCase fields.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { ResolvedTarget } from './providers/targets.js';
import type { Message, ProviderResponse, ProviderTokenUsage, ToolCall } from './providers/types.js';
import type { EvalTest } from './types.js';

export const REPLAY_FIXTURE_SCHEMA_VERSION = 'agentv.replay_fixture.v1';

const TokenUsageWireSchema = z
  .object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cached: z.number().nonnegative().optional(),
    reasoning: z.number().nonnegative().optional(),
  })
  .strict();

const ToolCallWireSchema = z
  .object({
    tool: z.string().min(1),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    id: z.string().optional(),
    status: z.enum(['ok', 'error', 'timeout', 'cancelled', 'unknown']).optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    duration_ms: z.number().nonnegative().optional(),
  })
  .strict();

const MessageWireSchema = z
  .object({
    role: z.string().min(1),
    name: z.string().optional(),
    content: z.unknown().optional(),
    tool_calls: z.array(ToolCallWireSchema).optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    duration_ms: z.number().nonnegative().optional(),
    metadata: z.record(z.unknown()).optional(),
    token_usage: TokenUsageWireSchema.optional(),
  })
  .strict();

const ReplayFixtureWireSchema = z
  .object({
    schema_version: z.literal(REPLAY_FIXTURE_SCHEMA_VERSION),
    suite: z.string().min(1),
    eval_path: z.string().min(1).optional(),
    test_id: z.string().min(1),
    source_target: z.string().min(1),
    attempt: z.number().int().min(0).optional(),
    variant: z.string().min(1).nullable().optional(),
    fixture_id: z.string().min(1).optional(),
    recorded_at: z.string().optional(),
    source: z.record(z.unknown()).optional(),
    redaction: z.record(z.unknown()).optional(),
    output: z.array(MessageWireSchema),
    transcript: z.unknown().optional(),
    token_usage: TokenUsageWireSchema.optional(),
    cost_usd: z.number().nonnegative().optional(),
    duration_ms: z.number().nonnegative().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
  })
  .strict();

type ToolCallWire = z.infer<typeof ToolCallWireSchema>;
type MessageWire = z.infer<typeof MessageWireSchema>;
type ReplayFixtureWireRecord = z.infer<typeof ReplayFixtureWireSchema>;

export interface ReplayFixtureRecord {
  readonly schemaVersion: typeof REPLAY_FIXTURE_SCHEMA_VERSION;
  readonly suite: string;
  readonly evalPath?: string;
  readonly testId: string;
  readonly sourceTarget: string;
  readonly attempt: number;
  readonly variant?: string;
  readonly fixtureId?: string;
  readonly recordedAt?: string;
  readonly source?: Record<string, unknown>;
  readonly redaction?: Record<string, unknown>;
  readonly output: readonly Message[];
  readonly transcript?: unknown;
  readonly tokenUsage?: ProviderTokenUsage;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly startTime?: string;
  readonly endTime?: string;
}

export interface ReplayFixtureLookup {
  readonly suite?: string;
  readonly evalPath?: string;
  readonly testId: string;
  readonly sourceTarget: string;
  readonly attempt?: number;
  readonly variant?: string;
}

export interface ReplayLookupIdentity {
  readonly suite?: string;
  readonly evalPath?: string;
  readonly testId: string;
  readonly sourceTarget: string;
  readonly attempt?: number;
  readonly variant?: string | null;
}

export interface ReplayRecordingOptions {
  readonly fixturesPath: string;
  readonly sourceTarget?: string;
  readonly variant?: string;
}

export interface BuildReplayFixtureRecordOptions {
  readonly evalCase: EvalTest;
  readonly evalFilePath: string;
  readonly repoRoot: string;
  readonly target: ResolvedTarget;
  readonly sourceTarget?: string;
  readonly attempt: number;
  readonly variant?: string;
  readonly response: ProviderResponse;
  readonly now?: () => Date;
}

const appendQueues = new Map<string, Promise<void>>();

function fromWireRecord(wire: ReplayFixtureWireRecord): ReplayFixtureRecord {
  return {
    schemaVersion: wire.schema_version,
    suite: wire.suite,
    evalPath: wire.eval_path,
    testId: wire.test_id,
    sourceTarget: wire.source_target,
    attempt: wire.attempt ?? 0,
    variant: wire.variant ?? undefined,
    fixtureId: wire.fixture_id,
    recordedAt: wire.recorded_at,
    source: wire.source,
    redaction: wire.redaction,
    output: wire.output.map(fromWireMessage),
    transcript: wire.transcript,
    tokenUsage: wire.token_usage,
    costUsd: wire.cost_usd,
    durationMs: wire.duration_ms,
    startTime: wire.start_time,
    endTime: wire.end_time,
  };
}

function fromWireMessage(wire: MessageWire): Message {
  return {
    role: wire.role,
    name: wire.name,
    content: wire.content as Message['content'],
    toolCalls: wire.tool_calls?.map(fromWireToolCall),
    startTime: wire.start_time,
    endTime: wire.end_time,
    durationMs: wire.duration_ms,
    metadata: wire.metadata,
    tokenUsage: wire.token_usage,
  };
}

function fromWireToolCall(wire: ToolCallWire): ToolCall {
  return {
    tool: wire.tool,
    input: wire.input,
    output: wire.output,
    id: wire.id,
    status: wire.status,
    startTime: wire.start_time,
    endTime: wire.end_time,
    durationMs: wire.duration_ms,
  };
}

function toWireRecord(record: ReplayFixtureRecord): ReplayFixtureWireRecord {
  const wire = {
    schema_version: record.schemaVersion,
    suite: record.suite,
    eval_path: record.evalPath,
    test_id: record.testId,
    source_target: record.sourceTarget,
    attempt: record.attempt,
    variant: record.variant ?? null,
    fixture_id: record.fixtureId,
    recorded_at: record.recordedAt,
    source: record.source,
    redaction: record.redaction,
    output: record.output.map(toWireMessage),
    transcript: record.transcript,
    token_usage: record.tokenUsage,
    cost_usd: record.costUsd,
    duration_ms: record.durationMs,
    start_time: record.startTime,
    end_time: record.endTime,
  } satisfies Record<string, unknown>;

  const parsed = ReplayFixtureWireSchema.parse(dropUndefined(wire));
  return parsed;
}

function toWireMessage(message: Message): MessageWire {
  return {
    role: message.role,
    name: message.name,
    content: message.content,
    tool_calls: message.toolCalls?.map(toWireToolCall),
    start_time: message.startTime,
    end_time: message.endTime,
    duration_ms: message.durationMs,
    metadata: message.metadata,
    token_usage: message.tokenUsage,
  };
}

function toWireToolCall(toolCall: ToolCall): ToolCallWire {
  return {
    tool: toolCall.tool,
    input: toolCall.input,
    output: toolCall.output,
    id: toolCall.id,
    status: toolCall.status,
    start_time: toolCall.startTime,
    end_time: toolCall.endTime,
    duration_ms: toolCall.durationMs,
  };
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join('.') : '<record>';
      return `${location}: ${issue.message}`;
    })
    .join('; ');
}

export async function readReplayFixtureRecords(
  fixturesPath: string,
): Promise<readonly ReplayFixtureRecord[]> {
  let raw: string;
  try {
    raw = await readFile(fixturesPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Replay fixture file not found or unreadable: ${fixturesPath}: ${reason}`);
  }

  const records: ReplayFixtureRecord[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid replay fixture JSONL at ${fixturesPath}:${i + 1}: ${reason}`);
    }

    const result = ReplayFixtureWireSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Invalid replay fixture record at ${fixturesPath}:${i + 1}: ${formatZodError(result.error)}`,
      );
    }
    records.push(fromWireRecord(result.data));
  }

  return records;
}

export function serializeReplayFixtureRecord(record: ReplayFixtureRecord): string {
  return JSON.stringify(toWireRecord(record));
}

export async function appendReplayFixtureRecord(
  fixturesPath: string,
  record: ReplayFixtureRecord,
): Promise<void> {
  const absolutePath = path.resolve(fixturesPath);
  const previous = appendQueues.get(absolutePath) ?? Promise.resolve();
  const next = previous.then(async () => {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${serializeReplayFixtureRecord(record)}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
  });
  appendQueues.set(
    absolutePath,
    next.catch(() => {
      /* keep the queue usable after a failed append */
    }),
  );
  await next;
}

export function findReplayFixtureRecord(
  records: readonly ReplayFixtureRecord[],
  lookup: ReplayFixtureLookup,
): ReplayFixtureRecord {
  const matches = records.filter((record) => replayRecordMatches(record, lookup));
  if (matches.length === 1) {
    return matches[0];
  }

  const key = formatReplayLookupKey(lookup);
  if (matches.length === 0) {
    throw new Error(`Replay fixture lookup found no record for ${key}`);
  }
  throw new Error(`Replay fixture lookup found ${matches.length} duplicate records for ${key}`);
}

function replayRecordMatches(record: ReplayFixtureRecord, lookup: ReplayFixtureLookup): boolean {
  return replayLookupIdentityMatches(record, lookup);
}

export function replayLookupIdentityMatches(
  identity: ReplayLookupIdentity,
  lookup: ReplayFixtureLookup,
): boolean {
  if (lookup.suite && identity.suite !== lookup.suite) {
    return false;
  }
  if (!lookup.suite && !lookup.evalPath) {
    throw new Error('Replay fixture lookup requires suite or eval_path identity');
  }
  if (identity.evalPath && !lookup.evalPath) {
    return false;
  }
  if (
    identity.evalPath &&
    lookup.evalPath &&
    !sameReplayEvalPath(identity.evalPath, lookup.evalPath)
  ) {
    return false;
  }
  return (
    identity.testId === lookup.testId &&
    identity.sourceTarget === lookup.sourceTarget &&
    (identity.attempt ?? 0) === (lookup.attempt ?? 0) &&
    (identity.variant ?? null) === (lookup.variant ?? null)
  );
}

function normalizeEvalPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function sameReplayEvalPath(recordPath: string, lookupPath: string): boolean {
  const record = normalizeEvalPath(recordPath);
  const lookup = normalizeEvalPath(lookupPath);
  if (record === lookup) {
    return true;
  }
  return path.isAbsolute(lookupPath) && lookup.endsWith(`/${record}`);
}

export function formatReplayLookupKey(lookup: ReplayFixtureLookup): string {
  const parts = [
    lookup.suite ? `suite=${lookup.suite}` : undefined,
    lookup.evalPath ? `eval_path=${lookup.evalPath}` : undefined,
    `test_id=${lookup.testId}`,
    `source_target=${lookup.sourceTarget}`,
    `attempt=${lookup.attempt ?? 0}`,
    `variant=${lookup.variant ?? '<none>'}`,
  ].filter((part): part is string => part !== undefined);
  return parts.join(' ');
}

export function replayFixtureRecordToProviderResponse(
  record: ReplayFixtureRecord,
): ProviderResponse {
  return {
    output: record.output,
    tokenUsage: record.tokenUsage,
    costUsd: record.costUsd,
    durationMs: record.durationMs,
    startTime: record.startTime,
    endTime: record.endTime,
    raw: {
      replay_fixture: dropUndefined({
        fixture_id: record.fixtureId,
        suite: record.suite,
        eval_path: record.evalPath,
        test_id: record.testId,
        source_target: record.sourceTarget,
        attempt: record.attempt,
        variant: record.variant,
        source: record.source,
        redaction: record.redaction,
        transcript: record.transcript,
      }),
    },
  };
}

export function buildReplayFixtureRecord({
  evalCase,
  evalFilePath,
  repoRoot,
  target,
  sourceTarget,
  attempt,
  variant,
  response,
  now = () => new Date(),
}: BuildReplayFixtureRecordOptions): ReplayFixtureRecord {
  const suite = evalCase.suite?.trim();
  if (!suite) {
    throw new Error(`Cannot record replay fixture for test '${evalCase.id}': suite is missing`);
  }

  const evalPath = path.relative(repoRoot, path.resolve(evalFilePath)).replace(/\\/g, '/');
  const resolvedSourceTarget = sourceTarget?.trim() || target.name;
  const fixtureId = buildFixtureId({
    suite,
    evalPath,
    testId: evalCase.id,
    sourceTarget: resolvedSourceTarget,
    attempt,
    variant,
  });

  return {
    schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
    suite,
    evalPath,
    testId: evalCase.id,
    sourceTarget: resolvedSourceTarget,
    attempt,
    variant,
    fixtureId,
    recordedAt: now().toISOString(),
    source: buildSourceMetadata(target, resolvedSourceTarget),
    output: response.output ?? [],
    transcript: extractTranscript(response.raw),
    tokenUsage: response.tokenUsage,
    costUsd: response.costUsd,
    durationMs: response.durationMs,
    startTime: response.startTime,
    endTime: response.endTime,
  };
}

function buildFixtureId(input: {
  readonly suite: string;
  readonly evalPath: string;
  readonly testId: string;
  readonly sourceTarget: string;
  readonly attempt: number;
  readonly variant?: string;
}): string {
  const stable = [
    input.suite,
    input.evalPath,
    input.testId,
    input.sourceTarget,
    String(input.attempt),
    input.variant ?? '',
  ].join('\0');
  const digest = createHash('sha256').update(stable).digest('hex').slice(0, 12);
  return `${input.sourceTarget}-${input.testId}-${digest}`;
}

function buildSourceMetadata(
  target: ResolvedTarget,
  sourceTarget: string,
): Record<string, unknown> {
  return dropUndefined({
    provider: target.kind,
    target_name: sourceTarget,
    resolved_target: target.name,
    model: extractModelName(target),
  });
}

function extractModelName(target: ResolvedTarget): string | undefined {
  const config = target.config as Record<string, unknown>;
  if (typeof config.model === 'string') {
    return config.model;
  }
  if (typeof config.deploymentName === 'string') {
    return config.deploymentName;
  }
  return undefined;
}

function extractTranscript(raw: unknown): unknown | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const transcript = (raw as { readonly transcript?: unknown }).transcript;
  return transcript;
}
