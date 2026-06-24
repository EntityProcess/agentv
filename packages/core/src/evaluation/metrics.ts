/**
 * AgentV metrics v1.
 *
 * This is a derived per-attempt executor metrics projection over
 * `EvaluationResult` and `agentv.trace.v1`. It combines the Anthropic
 * skill-eval `metrics.json` counters with the compact Vercel observability
 * counters. It is not the canonical trace store; full detail stays in
 * `trace.json`, ordered transcript compatibility rows stay in transcript
 * artifacts, and duration/token/cost usage stays in `timing.json`.
 */

import { z } from 'zod';
import type { Message, ToolCall } from './providers/types.js';
import { METRICS_SCHEMA_VERSION } from './result-artifact-contract.js';
import type { TraceEnvelope } from './trace-envelope.js';
import type { TraceEvent } from './trace.js';
import type { EvaluationResult } from './types.js';

const TOOL_STATUS_VALUES = ['ok', 'error', 'timeout', 'cancelled', 'unknown'] as const;
const FILE_READ_KEY_SET = new Set([
  'file',
  'filename',
  'filepath',
  'path',
  'targetfile',
  'targetpath',
  'relativepath',
  '_extractedpath',
]);

const COMMAND_KEY_SET = new Set([
  'cmd',
  'command',
  'script',
  'shellcommand',
  'extractedcommand',
  '_extractedcommand',
]);

const URL_KEY_SET = new Set(['url', 'uri', 'href', 'extractedurl', '_extractedurl']);

const EXIT_CODE_KEY_SET = new Set(['exitcode', 'exitstatus', 'code', 'statuscode']);
const STATUS_CODE_KEY_SET = new Set(['status', 'statuscode', 'httpstatus', 'httpstatuscode']);

const ExecutionToolCallWireSchema = z
  .object({
    position: z.number().int().nonnegative(),
    tool: z.string(),
    category: z.string(),
    tool_call_id: z.string().optional(),
    message_index: z.number().int().nonnegative().optional(),
    tool_index: z.number().int().nonnegative().optional(),
    status: z.enum(TOOL_STATUS_VALUES).optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    duration_ms: z.number().nonnegative().optional(),
  })
  .strict();

const ShellCommandWireSchema = z
  .object({
    command: z.string(),
    tool_call_id: z.string().optional(),
    exit_code: z.number().int().optional(),
    success: z.boolean().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    duration_ms: z.number().nonnegative().optional(),
  })
  .strict();

const FileReferenceWireSchema = z
  .object({
    path: z.string(),
    tool_call_id: z.string().optional(),
    operation: z.string().optional(),
    source: z.string(),
  })
  .strict();

const WebFetchWireSchema = z
  .object({
    url: z.string(),
    method: z.string().optional(),
    status: z.number().int().optional(),
    success: z.boolean().optional(),
    tool_call_id: z.string().optional(),
  })
  .strict();

const ExecutionErrorWireSchema = z
  .object({
    message: z.string(),
    name: z.string().optional(),
    code: z.string().optional(),
    stage: z.string().optional(),
    tool_call_id: z.string().optional(),
    event_id: z.string().optional(),
  })
  .strict();

const ReasoningBlockWireSchema = z
  .object({
    source: z.string(),
    kind: z.enum(['thinking', 'reasoning']),
    message_index: z.number().int().nonnegative().optional(),
    event_id: z.string().optional(),
    content: z.string().optional(),
  })
  .strict();

export const MetricsWireSchema = z
  .object({
    tool_calls: z.record(z.string(), z.number().int().nonnegative()),
    tool_call_counts: z.record(z.string(), z.number().int().nonnegative()),
    tool_category_counts: z.record(z.string(), z.number().int().nonnegative()),
    total_tool_calls: z.number().int().nonnegative(),
    total_steps: z.number().int().nonnegative(),
    total_turns: z.number().int().nonnegative(),
    tool_call_events: z.array(ExecutionToolCallWireSchema),
    shell_commands: z.array(ShellCommandWireSchema),
    files_read: z.array(FileReferenceWireSchema),
    files_modified: z.array(FileReferenceWireSchema),
    files_created: z.array(z.string()),
    web_fetches: z.array(WebFetchWireSchema),
    errors: z.array(ExecutionErrorWireSchema),
    errors_encountered: z.number().int().nonnegative(),
    output_chars: z.number().int().nonnegative(),
    transcript_chars: z.number().int().nonnegative(),
    reasoning_blocks: z.array(ReasoningBlockWireSchema),
    thinking_blocks: z.number().int().nonnegative(),
  })
  .strict();

export const MetricsArtifactWireSchema = z
  .object({
    schema_version: z.literal(METRICS_SCHEMA_VERSION),
    generated_at: z.string(),
    test_id: z.string(),
    target: z.string(),
    suite: z.string().optional(),
    category: z.string().optional(),
    source_artifacts: z
      .object({
        transcript_path: z.string().optional(),
        grading_path: z.string().optional(),
        timing_path: z.string().optional(),
      })
      .strict()
      .optional(),
    tool_calls: z.record(z.string(), z.number().int().nonnegative()),
    tool_call_counts: z.record(z.string(), z.number().int().nonnegative()),
    tool_category_counts: z.record(z.string(), z.number().int().nonnegative()),
    total_tool_calls: z.number().int().nonnegative(),
    total_steps: z.number().int().nonnegative(),
    total_turns: z.number().int().nonnegative(),
    tool_call_events: z.array(ExecutionToolCallWireSchema),
    shell_commands: z.array(ShellCommandWireSchema),
    files_read: z.array(FileReferenceWireSchema),
    files_modified: z.array(FileReferenceWireSchema),
    files_created: z.array(z.string()),
    web_fetches: z.array(WebFetchWireSchema),
    errors: z.array(ExecutionErrorWireSchema),
    errors_encountered: z.number().int().nonnegative(),
    output_chars: z.number().int().nonnegative(),
    transcript_chars: z.number().int().nonnegative(),
    reasoning_blocks: z.array(ReasoningBlockWireSchema),
    thinking_blocks: z.number().int().nonnegative(),
  })
  .strict();

export type MetricsArtifactWire = z.infer<typeof MetricsArtifactWireSchema>;

type ToolCallRef = {
  readonly toolCall: ToolCall;
  readonly messageIndex: number;
  readonly toolIndex: number;
  readonly position: number;
};

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function collectStringValuesByKey(
  value: unknown,
  keys: ReadonlySet<string>,
  options: { maxDepth?: number } = {},
): string[] {
  const maxDepth = options.maxDepth ?? 6;
  const values = new Set<string>();

  function visit(entry: unknown, depth: number): void {
    if (depth > maxDepth) {
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item, depth + 1);
      }
      return;
    }
    if (!isRecord(entry)) {
      return;
    }
    for (const [key, nested] of Object.entries(entry)) {
      const normalized = normalizedKey(key);
      if (keys.has(normalized)) {
        if (typeof nested === 'string' && nested.trim().length > 0) {
          values.add(nested.trim());
        } else if (Array.isArray(nested)) {
          for (const item of nested) {
            if (typeof item === 'string' && item.trim().length > 0) {
              values.add(item.trim());
            }
          }
        }
      }
      visit(nested, depth + 1);
    }
  }

  visit(value, 0);
  return [...values];
}

function findNumberByKey(
  value: unknown,
  keys: ReadonlySet<string>,
  maxDepth = 4,
): number | undefined {
  function visit(entry: unknown, depth: number): number | undefined {
    if (depth > maxDepth) {
      return undefined;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        const result = visit(item, depth + 1);
        if (result !== undefined) {
          return result;
        }
      }
      return undefined;
    }
    if (!isRecord(entry)) {
      return undefined;
    }
    for (const [key, nested] of Object.entries(entry)) {
      if (keys.has(normalizedKey(key))) {
        const numeric = numberValue(nested);
        if (numeric !== undefined) {
          return numeric;
        }
      }
      const result = visit(nested, depth + 1);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  return visit(value, 0);
}

function firstStringByKey(value: unknown, keys: ReadonlySet<string>): string | undefined {
  return collectStringValuesByKey(value, keys)[0];
}

function incrementCount(counts: Record<string, number>, key: string, amount = 1): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

function toolCategory(tool: string): string {
  const normalized = normalizedKey(tool);
  if (
    normalized === 'bash' ||
    normalized.includes('shell') ||
    normalized.includes('terminal') ||
    normalized.includes('commandexecution') ||
    normalized.includes('execcommand')
  ) {
    return 'shell';
  }
  if (normalized.includes('websearch') || normalized === 'searchweb') {
    return 'web_search';
  }
  if (
    normalized.includes('webfetch') ||
    normalized.includes('fetchurl') ||
    normalized === 'fetch' ||
    normalized === 'fetchdoc' ||
    normalized === 'httpget'
  ) {
    return 'web_fetch';
  }
  if (normalized === 'read' || normalized.includes('fileread') || normalized === 'viewfile') {
    return 'file_read';
  }
  if (normalized === 'write' || normalized.includes('filewrite') || normalized === 'createfile') {
    return 'file_write';
  }
  if (
    normalized === 'edit' ||
    normalized.includes('fileedit') ||
    normalized.includes('filechange') ||
    normalized.includes('applypatch') ||
    normalized.includes('replaceinfile')
  ) {
    return 'file_edit';
  }
  if (normalized === 'glob' || normalized.includes('glob')) {
    return 'glob';
  }
  if (normalized === 'grep' || normalized.includes('grep') || normalized.includes('ripgrep')) {
    return 'grep';
  }
  if (normalized.includes('listdir') || normalized.includes('lsdir') || normalized === 'ls') {
    return 'list_dir';
  }
  if (
    normalized === 'skill' ||
    normalized.includes('agenttask') ||
    normalized.includes('subagent')
  ) {
    return 'agent_task';
  }
  return 'unknown';
}

function collectToolCalls(messages: readonly Message[]): ToolCallRef[] {
  const toolCalls: ToolCallRef[] = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const calls = messages[messageIndex]?.toolCalls ?? [];
    for (let toolIndex = 0; toolIndex < calls.length; toolIndex++) {
      toolCalls.push({
        toolCall: calls[toolIndex],
        messageIndex,
        toolIndex,
        position: toolCalls.length,
      });
    }
  }
  return toolCalls;
}

function buildToolCallCounts(
  result: EvaluationResult,
  calls: readonly ToolCallRef[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of calls) {
    incrementCount(counts, call.toolCall.tool);
  }
  if (Object.keys(counts).length > 0) {
    return counts;
  }
  return { ...(result.trace.toolCalls ?? {}) };
}

function buildToolCategoryCounts(
  toolCallCounts: Readonly<Record<string, number>>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [tool, count] of Object.entries(toolCallCounts)) {
    incrementCount(counts, toolCategory(tool), count);
  }
  return counts;
}

function toolStatus(toolCall: ToolCall): (typeof TOOL_STATUS_VALUES)[number] | undefined {
  return toolCall.status;
}

function toolSucceeded(toolCall: ToolCall): boolean | undefined {
  if (toolCall.status === 'ok') {
    return true;
  }
  if (
    toolCall.status === 'error' ||
    toolCall.status === 'timeout' ||
    toolCall.status === 'cancelled'
  ) {
    return false;
  }
  const explicitSuccess =
    booleanValue(isRecord(toolCall.output) ? toolCall.output.success : undefined) ??
    booleanValue(isRecord(toolCall.output) ? toolCall.output.ok : undefined);
  if (explicitSuccess !== undefined) {
    return explicitSuccess;
  }
  const exitCode = findNumberByKey(toolCall.output, EXIT_CODE_KEY_SET);
  return exitCode !== undefined ? exitCode === 0 : undefined;
}

function buildToolCallSummaries(calls: readonly ToolCallRef[]) {
  return calls.map((call) =>
    dropUndefined({
      position: call.position,
      tool: call.toolCall.tool,
      category: toolCategory(call.toolCall.tool),
      tool_call_id: call.toolCall.id,
      message_index: call.messageIndex,
      tool_index: call.toolIndex,
      status: toolStatus(call.toolCall),
      start_time: call.toolCall.startTime,
      end_time: call.toolCall.endTime,
      duration_ms: call.toolCall.durationMs,
    }),
  );
}

function buildShellCommands(calls: readonly ToolCallRef[]) {
  return calls.flatMap((call) => {
    if (toolCategory(call.toolCall.tool) !== 'shell') {
      return [];
    }
    const command = firstStringByKey(call.toolCall.input, COMMAND_KEY_SET);
    if (!command) {
      return [];
    }
    return [
      dropUndefined({
        command,
        tool_call_id: call.toolCall.id,
        exit_code: findNumberByKey(call.toolCall.output, EXIT_CODE_KEY_SET),
        success: toolSucceeded(call.toolCall),
        start_time: call.toolCall.startTime,
        end_time: call.toolCall.endTime,
        duration_ms: call.toolCall.durationMs,
      }),
    ];
  });
}

function uniqueFileReferences(
  refs: readonly z.infer<typeof FileReferenceWireSchema>[],
): z.infer<typeof FileReferenceWireSchema>[] {
  const seen = new Set<string>();
  const unique: z.infer<typeof FileReferenceWireSchema>[] = [];
  for (const ref of refs) {
    const key = `${ref.path}\0${ref.operation ?? ''}\0${ref.source}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function buildFileReads(calls: readonly ToolCallRef[]) {
  const refs = calls.flatMap((call) => {
    if (toolCategory(call.toolCall.tool) !== 'file_read') {
      return [];
    }
    return collectStringValuesByKey(call.toolCall.input, FILE_READ_KEY_SET).map(
      (filePath) =>
        dropUndefined({
          path: filePath,
          tool_call_id: call.toolCall.id,
          source: 'tool_input',
        }) as z.infer<typeof FileReferenceWireSchema>,
    );
  });
  return uniqueFileReferences(refs);
}

function parseModifiedPathsFromDiff(fileChanges: string | undefined): string[] {
  if (!fileChanges) {
    return [];
  }
  const paths = new Set<string>();
  for (const line of fileChanges.split('\n')) {
    if (!line.startsWith('+++ b/')) {
      continue;
    }
    const filePath = line.slice('+++ b/'.length).trim();
    if (filePath && filePath !== '/dev/null') {
      paths.add(filePath);
    }
  }
  return [...paths];
}

function parseCreatedPathsFromDiff(fileChanges: string | undefined): string[] {
  if (!fileChanges) {
    return [];
  }
  const paths = new Set<string>();
  const lines = fileChanges.split('\n');
  for (let index = 0; index < lines.length - 1; index++) {
    if (lines[index] !== '--- /dev/null') {
      continue;
    }
    const nextLine = lines[index + 1];
    if (!nextLine?.startsWith('+++ b/')) {
      continue;
    }
    const filePath = nextLine.slice('+++ b/'.length).trim();
    if (filePath && filePath !== '/dev/null') {
      paths.add(filePath);
    }
  }
  return [...paths];
}

function buildFileModifications(result: EvaluationResult, calls: readonly ToolCallRef[]) {
  const refs: z.infer<typeof FileReferenceWireSchema>[] = [];
  for (const call of calls) {
    const category = toolCategory(call.toolCall.tool);
    if (category !== 'file_write' && category !== 'file_edit') {
      continue;
    }
    const operation = category === 'file_write' ? 'write' : 'edit';
    for (const filePath of collectStringValuesByKey(call.toolCall.input, FILE_READ_KEY_SET)) {
      refs.push(
        dropUndefined({
          path: filePath,
          operation,
          tool_call_id: call.toolCall.id,
          source: 'tool_input',
        }) as z.infer<typeof FileReferenceWireSchema>,
      );
    }
  }

  for (const filePath of parseModifiedPathsFromDiff(result.fileChanges)) {
    refs.push({
      path: filePath,
      operation: 'workspace_diff',
      source: 'file_changes',
    });
  }

  return uniqueFileReferences(refs);
}

function buildFilesCreated(result: EvaluationResult, calls: readonly ToolCallRef[]): string[] {
  const paths = new Set<string>(parseCreatedPathsFromDiff(result.fileChanges));
  for (const call of calls) {
    if (toolCategory(call.toolCall.tool) !== 'file_write') {
      continue;
    }
    for (const filePath of collectStringValuesByKey(call.toolCall.input, FILE_READ_KEY_SET)) {
      paths.add(filePath);
    }
  }
  return [...paths];
}

function buildWebFetches(calls: readonly ToolCallRef[]) {
  return calls.flatMap((call) => {
    if (toolCategory(call.toolCall.tool) !== 'web_fetch') {
      return [];
    }
    const url = firstStringByKey(call.toolCall.input, URL_KEY_SET);
    if (!url) {
      return [];
    }
    return [
      dropUndefined({
        url,
        method: stringValue(isRecord(call.toolCall.input) ? call.toolCall.input.method : undefined),
        status: findNumberByKey(call.toolCall.output, STATUS_CODE_KEY_SET),
        success: toolSucceeded(call.toolCall),
        tool_call_id: call.toolCall.id,
      }),
    ];
  });
}

function errorFromUnknown(
  value: unknown,
  fallback?: Partial<z.infer<typeof ExecutionErrorWireSchema>>,
): z.infer<typeof ExecutionErrorWireSchema> | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return dropUndefined({ message: value.trim(), ...fallback });
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const message =
    stringValue(value.message) ?? stringValue(value.error) ?? stringValue(value.reason);
  if (!message) {
    return undefined;
  }
  return dropUndefined({
    message,
    name: stringValue(value.name),
    code: stringValue(value.code),
    ...fallback,
  });
}

function buildErrors(result: EvaluationResult, calls: readonly ToolCallRef[]) {
  const errors: z.infer<typeof ExecutionErrorWireSchema>[] = [];
  const topLevelError = errorFromUnknown(result.error, {
    stage: result.failureStage,
  });
  if (topLevelError) {
    errors.push(topLevelError);
  }
  const executionError = errorFromUnknown(result.executionError, {
    stage: result.executionError?.stage ?? result.failureStage,
  });
  if (executionError) {
    errors.push(executionError);
  }

  for (const event of result.trace.events ?? []) {
    if (event.type !== 'error' && !event.error) {
      continue;
    }
    const eventError = errorFromUnknown(event.error ?? event.metadata?.error, {
      event_id: event.eventId,
    });
    if (eventError) {
      errors.push(eventError);
    }
  }

  for (const call of calls) {
    if (
      call.toolCall.status !== 'error' &&
      call.toolCall.status !== 'timeout' &&
      call.toolCall.status !== 'cancelled'
    ) {
      continue;
    }
    const toolError =
      errorFromUnknown(call.toolCall.output, { tool_call_id: call.toolCall.id }) ??
      dropUndefined({
        message: `Tool ${call.toolCall.tool} ${call.toolCall.status}`,
        tool_call_id: call.toolCall.id,
      });
    errors.push(toolError);
  }

  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.message}\0${error.stage ?? ''}\0${error.tool_call_id ?? ''}\0${
      error.event_id ?? ''
    }`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function contentBlockText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return (
    stringValue(value.text) ??
    stringValue(value.content) ??
    stringValue(value.value) ??
    stringValue(value.summary)
  );
}

function collectReasoningFromRecord(
  record: Record<string, unknown>,
  context: { source: string; messageIndex?: number; eventId?: string },
) {
  const blocks: z.infer<typeof ReasoningBlockWireSchema>[] = [];
  for (const kind of ['thinking', 'reasoning'] as const) {
    const value = record[kind] ?? record[`${kind}_block`] ?? record[`${kind}_blocks`];
    if (Array.isArray(value)) {
      for (const item of value) {
        blocks.push(
          dropUndefined({
            source: context.source,
            kind,
            message_index: context.messageIndex,
            event_id: context.eventId,
            content: contentBlockText(item),
          }) as z.infer<typeof ReasoningBlockWireSchema>,
        );
      }
      continue;
    }
    const text = contentBlockText(value);
    if (text) {
      blocks.push(
        dropUndefined({
          source: context.source,
          kind,
          message_index: context.messageIndex,
          event_id: context.eventId,
          content: text,
        }) as z.infer<typeof ReasoningBlockWireSchema>,
      );
    }
  }
  return blocks;
}

function buildReasoningBlocks(messages: readonly Message[], events: readonly TraceEvent[]) {
  const blocks: z.infer<typeof ReasoningBlockWireSchema>[] = [];

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (message.metadata) {
      blocks.push(
        ...collectReasoningFromRecord(message.metadata, {
          source: 'message_metadata',
          messageIndex,
        }),
      );
    }
    const content = message.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        const block = item as unknown;
        if (!isRecord(block)) {
          continue;
        }
        const blockType = block.type;
        const kind = blockType === 'thinking' || blockType === 'reasoning' ? blockType : undefined;
        if (!kind) {
          continue;
        }
        blocks.push(
          dropUndefined({
            source: 'message_content',
            kind,
            message_index: messageIndex,
            content: contentBlockText(block),
          }) as z.infer<typeof ReasoningBlockWireSchema>,
        );
      }
    }
  }

  for (const event of events) {
    if (event.metadata) {
      blocks.push(
        ...collectReasoningFromRecord(event.metadata, {
          source: 'event_metadata',
          eventId: event.eventId,
        }),
      );
    }
  }

  return blocks;
}

function buildTranscriptCharCount(
  messages: readonly Message[],
  events: readonly TraceEvent[],
): number {
  const rows = [...messages, ...events].map((entry) => JSON.stringify(entry));
  return rows.length === 0 ? 0 : rows.join('\n').length + 1;
}

function buildMetrics(result: EvaluationResult) {
  const messages = result.trace.messages ?? [];
  const events = result.trace.events ?? [];
  const calls = collectToolCalls(messages);
  const toolCallCounts = buildToolCallCounts(result, calls);
  const totalToolCalls =
    calls.length > 0
      ? calls.length
      : Object.values(toolCallCounts).reduce((sum, count) => sum + count, 0);
  const reasoningBlocks = buildReasoningBlocks(messages, events);
  const errors = buildErrors(result, calls);
  const totalTurns =
    result.trace.llmCallCount ?? messages.filter((message) => message.role === 'assistant').length;

  return {
    tool_calls: toolCallCounts,
    tool_call_counts: toolCallCounts,
    tool_category_counts: buildToolCategoryCounts(toolCallCounts),
    total_tool_calls: totalToolCalls,
    total_steps: totalTurns,
    total_turns: totalTurns,
    tool_call_events: buildToolCallSummaries(calls),
    shell_commands: buildShellCommands(calls),
    files_read: buildFileReads(calls),
    files_modified: buildFileModifications(result, calls),
    files_created: buildFilesCreated(result, calls),
    web_fetches: buildWebFetches(calls),
    errors,
    errors_encountered: errors.length,
    output_chars: result.output.length,
    transcript_chars: buildTranscriptCharCount(messages, events),
    reasoning_blocks: reasoningBlocks,
    thinking_blocks: reasoningBlocks.length,
  };
}

export function buildMetricsArtifact(
  result: EvaluationResult,
  envelope: TraceEnvelope,
  options: {
    transcriptPath?: string;
    gradingPath?: string;
    timingPath?: string;
    generatedAt?: string;
  } = {},
): MetricsArtifactWire {
  const metrics = buildMetrics(result);
  return MetricsArtifactWireSchema.parse(
    dropUndefined({
      schema_version: METRICS_SCHEMA_VERSION,
      generated_at: options.generatedAt ?? envelope.createdAt,
      test_id: result.testId ?? 'unknown',
      target: result.target ?? 'unknown',
      suite: result.suite,
      category: result.category,
      source_artifacts: dropUndefined({
        transcript_path: options.transcriptPath,
        grading_path: options.gradingPath,
        timing_path: options.timingPath,
      }),
      ...metrics,
    }),
  );
}
