/**
 * Result JSONL row schema used at the AgentV artifact boundary.
 *
 * Canonical AgentV run manifests are `index.jsonl` files with snake_case keys
 * and a numeric `score`. Historical rows produced from TypeScript
 * `EvaluationResult` objects may contain a small set of camelCase aliases.
 * Normalize those aliases only at this boundary; callers should work with the
 * canonical snake_case row shape or convert once into TypeScript internals.
 */

export class ResultRowSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResultRowSchemaError';
  }
}

const MIGRATION_GUIDANCE =
  'Expected an AgentV result row with a numeric score. Eval-case JSONL is input data, not a results artifact. Run `agentv eval <eval-file> --output <run-dir>` and pass the run workspace or its index.jsonl manifest.';

const RESULT_ROW_ALIASES = {
  answerPath: 'answer_path',
  artifactDir: 'artifact_dir',
  benchmarkPath: 'benchmark_path',
  conversationId: 'conversation_id',
  costUsd: 'cost_usd',
  durationMs: 'duration_ms',
  endTime: 'end_time',
  evalPath: 'eval_path',
  metricsPath: 'metrics_path',
  executionStatus: 'execution_status',
  failureReasonCode: 'failure_reason_code',
  failureStage: 'failure_stage',
  filesPath: 'files_path',
  gradersPath: 'graders_path',
  gradingPath: 'grading_path',
  inputPath: 'input_path',
  outputPath: 'output_path',
  rawProviderLogPath: 'raw_provider_log_path',
  responsePath: 'response_path',
  startTime: 'start_time',
  summaryPath: 'summary_path',
  targetsPath: 'targets_path',
  taskDir: 'task_dir',
  testId: 'test_id',
  timingPath: 'timing_path',
  tokenUsage: 'token_usage',
  tracePath: 'trace_path',
  transcriptPath: 'transcript_path',
  workspacePath: 'workspace_path',
} as const;

const NEW_SNAKE_CASE_ONLY_FIELDS = {
  artifactPointers: 'artifact_pointers',
} as const;

const TRACE_SUMMARY_ALIASES = {
  costUsd: 'cost_usd',
  durationMs: 'duration_ms',
  errorCount: 'error_count',
  eventCount: 'event_count',
  llmCallCount: 'llm_call_count',
  tokenUsage: 'token_usage',
  toolCalls: 'tool_calls',
  toolDurations: 'tool_durations',
} as const;

const MESSAGE_ALIASES = {
  durationMs: 'duration_ms',
  endTime: 'end_time',
  startTime: 'start_time',
  tokenUsage: 'token_usage',
  toolCalls: 'tool_calls',
} as const;

const TOOL_CALL_ALIASES = {
  durationMs: 'duration_ms',
  endTime: 'end_time',
  startTime: 'start_time',
} as const;

type AliasMap = Readonly<Record<string, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKnownAliases(value: Record<string, unknown>, aliases: AliasMap) {
  const normalized = { ...value };
  for (const [camelKey, snakeKey] of Object.entries(aliases)) {
    if (normalized[snakeKey] === undefined && normalized[camelKey] !== undefined) {
      normalized[snakeKey] = normalized[camelKey];
    }
    if (camelKey !== snakeKey) {
      delete normalized[camelKey];
    }
  }
  return normalized;
}

function normalizeToolCall(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return normalizeKnownAliases(value, TOOL_CALL_ALIASES);
}

function normalizeMessage(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized = normalizeKnownAliases(value, MESSAGE_ALIASES);
  if (Array.isArray(normalized.tool_calls)) {
    normalized.tool_calls = normalized.tool_calls.map(normalizeToolCall);
  }
  return normalized;
}

function normalizeTraceSummary(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized = normalizeKnownAliases(value, TRACE_SUMMARY_ALIASES);
  if (Array.isArray(normalized.messages)) {
    normalized.messages = normalized.messages.map(normalizeMessage);
  }
  return normalized;
}

function normalizeOutput(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map(normalizeMessage);
}

function buildSchemaError(context: {
  lineNumber?: number;
  sourceLabel?: string;
}): ResultRowSchemaError {
  const location = [
    context.sourceLabel ? ` in ${context.sourceLabel}` : '',
    context.lineNumber !== undefined ? ` at line ${context.lineNumber}` : '',
  ].join('');
  return new ResultRowSchemaError(`Unsupported result row${location}. ${MIGRATION_GUIDANCE}`);
}

function buildInvalidScoreError(context: {
  lineNumber?: number;
  sourceLabel?: string;
}): ResultRowSchemaError {
  const location = [
    context.sourceLabel ? ` in ${context.sourceLabel}` : '',
    context.lineNumber !== undefined ? ` at line ${context.lineNumber}` : '',
  ].join('');
  return new ResultRowSchemaError(`Missing or invalid score in result row${location}.`);
}

function buildSnakeCaseOnlyFieldError(
  field: keyof typeof NEW_SNAKE_CASE_ONLY_FIELDS,
  context: { lineNumber?: number; sourceLabel?: string },
): ResultRowSchemaError {
  const location = [
    context.sourceLabel ? ` in ${context.sourceLabel}` : '',
    context.lineNumber !== undefined ? ` at line ${context.lineNumber}` : '',
  ].join('');
  return new ResultRowSchemaError(
    `Unsupported camelCase result row field "${field}"${location}. Use "${NEW_SNAKE_CASE_ONLY_FIELDS[field]}".`,
  );
}

function looksLikeResultRow(value: Record<string, unknown>): boolean {
  return (
    typeof value.test_id === 'string' ||
    Object.hasOwn(value, 'score') ||
    Object.hasOwn(value, 'trace') ||
    Object.hasOwn(value, 'spans') ||
    Object.hasOwn(value, 'target') ||
    Object.hasOwn(value, 'benchmark_path') ||
    Object.hasOwn(value, 'grading_path') ||
    Object.hasOwn(value, 'timing_path')
  );
}

export function normalizeResultRow(
  value: unknown,
  context: { lineNumber?: number; sourceLabel?: string } = {},
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw buildSchemaError(context);
  }

  for (const field of Object.keys(
    NEW_SNAKE_CASE_ONLY_FIELDS,
  ) as (keyof typeof NEW_SNAKE_CASE_ONLY_FIELDS)[]) {
    if (Object.hasOwn(value, field)) {
      throw buildSnakeCaseOnlyFieldError(field, context);
    }
  }

  const normalized = normalizeKnownAliases(value, RESULT_ROW_ALIASES);
  if (normalized.trace !== undefined) {
    normalized.trace = normalizeTraceSummary(normalized.trace);
  }
  if (normalized.output !== undefined) {
    normalized.output = normalizeOutput(normalized.output);
  }

  if (typeof normalized.score !== 'number' || !Number.isFinite(normalized.score)) {
    if (looksLikeResultRow(normalized)) {
      throw buildInvalidScoreError(context);
    }
    throw buildSchemaError(context);
  }

  return normalized;
}
