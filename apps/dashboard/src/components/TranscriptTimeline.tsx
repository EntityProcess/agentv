/**
 * Structured transcript viewer for canonical `transcript.jsonl` files.
 *
 * The component intentionally reads only transcript JSONL rows derived from
 * AgentV trace data. It does not parse `response.md` or markdown transcripts;
 * raw transcript/answer artifacts stay available through the Files tab or raw
 * artifact links supplied by the caller.
 */

import { type ReactNode, type SyntheticEvent, useEffect, useMemo, useState } from 'react';

import type { FileNode } from '~/lib/types';

interface TranscriptSource {
  provider?: string;
  session_id?: string;
  model?: string;
  timestamp?: string;
  git_branch?: string;
  cwd?: string;
  version?: string;
}

interface TokenUsageWire {
  input?: number;
  output?: number;
  cached?: number;
  reasoning?: number;
}

export interface TranscriptJsonLine {
  test_id: string;
  target: string;
  message_index: number;
  role: string;
  agent?: string;
  model?: string;
  name?: string;
  content?: unknown;
  tool_calls?: readonly Record<string, unknown>[];
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
  token_usage?: TokenUsageWire;
  transcript_token_usage?: TokenUsageWire;
  transcript_duration_ms?: number;
  transcript_cost_usd?: number | null;
  source?: TranscriptSource;
}

export interface TranscriptParseResult {
  entries: TranscriptJsonLine[];
  error?: string;
}

interface TranscriptTimelineProps {
  entries: readonly TranscriptJsonLine[];
  finalAnswer?: string;
  answerPath?: string;
  transcriptPath?: string;
  answerHref?: string;
  transcriptHref?: string;
  transcriptDownloadHref?: string;
  onOpenFile?: (path: string) => void;
}

const ROLE_STYLES: Record<
  string,
  { container: string; badge: string; label: string; accent: string }
> = {
  system: {
    container: 'border-gray-800 bg-gray-900/70',
    badge: 'border-gray-700 bg-gray-800 text-gray-300',
    label: 'System',
    accent: 'text-gray-400',
  },
  user: {
    container: 'border-cyan-900/60 bg-cyan-950/20',
    badge: 'border-cyan-900/60 bg-cyan-950/30 text-cyan-300',
    label: 'User',
    accent: 'text-cyan-300',
  },
  assistant: {
    container: 'border-gray-800 bg-gray-900',
    badge: 'border-gray-700 bg-gray-800 text-gray-200',
    label: 'Assistant',
    accent: 'text-gray-300',
  },
  tool: {
    container: 'border-amber-900/60 bg-amber-950/20',
    badge: 'border-amber-900/60 bg-amber-950/30 text-amber-300',
    label: 'Tool result',
    accent: 'text-amber-300',
  },
  function: {
    container: 'border-amber-900/60 bg-amber-950/20',
    badge: 'border-amber-900/60 bg-amber-950/30 text-amber-300',
    label: 'Function result',
    accent: 'text-amber-300',
  },
};

interface ToolCallViewModel {
  id: string;
  call: Record<string, unknown>;
  index: number;
  name: string;
  status?: string;
  duration?: string;
}

interface TranscriptMessageViewModel {
  id: string;
  anchorId: string;
  line: TranscriptJsonLine;
  ordinal: number;
  roleStyle: { container: string; badge: string; label: string; accent: string };
  content: string;
  duration?: string;
  tokenUsage?: string;
  toolCalls: ToolCallViewModel[];
}

type TranscriptFilter = 'all' | 'messages' | 'with-tools' | 'tool-results';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTranscriptJsonLine(value: unknown): value is TranscriptJsonLine {
  if (!isRecord(value)) return false;
  if (value.tool_calls !== undefined && !Array.isArray(value.tool_calls)) return false;
  return (
    typeof value.test_id === 'string' &&
    typeof value.target === 'string' &&
    typeof value.message_index === 'number' &&
    Number.isFinite(value.message_index) &&
    typeof value.role === 'string'
  );
}

function isNormalizedTranscriptLine(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.v === 1 &&
    typeof value.agent === 'string' &&
    (value.type === 'system' || value.type === 'user' || value.type === 'assistant') &&
    Array.isArray(value.content)
  );
}

function normalizeToolUseBlock(block: Record<string, unknown>): Record<string, unknown> {
  const result = isRecord(block.result) ? block.result : undefined;
  return {
    id: typeof block.id === 'string' ? block.id : undefined,
    tool: typeof block.name === 'string' ? block.name : 'tool',
    input: block.input,
    output: result?.output,
    status: typeof result?.status === 'string' ? result.status : undefined,
    duration_ms: typeof result?.duration_ms === 'number' ? result.duration_ms : undefined,
    metadata: isRecord(block.metadata) ? block.metadata : undefined,
  };
}

function normalizedTranscriptLineToTimelineEntry(
  value: Record<string, unknown>,
  messageIndex: number,
): TranscriptJsonLine {
  const content = value.content as readonly unknown[];
  const toolCalls = content
    .filter(
      (block): block is Record<string, unknown> => isRecord(block) && block.type === 'tool_use',
    )
    .map(normalizeToolUseBlock);
  const inputTokens = typeof value.input_tokens === 'number' ? value.input_tokens : undefined;
  const outputTokens = typeof value.output_tokens === 'number' ? value.output_tokens : undefined;
  const tokenUsage =
    inputTokens !== undefined || outputTokens !== undefined
      ? {
          input: inputTokens ?? 0,
          output: outputTokens ?? 0,
        }
      : undefined;

  return {
    test_id: '',
    target: value.agent as string,
    message_index: messageIndex,
    role: value.type as string,
    agent: value.agent as string,
    model: typeof value.model === 'string' ? value.model : undefined,
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    start_time: typeof value.ts === 'string' ? value.ts : undefined,
    token_usage: tokenUsage,
    metadata: typeof value.id === 'string' ? { id: value.id } : undefined,
    source: {
      provider: value.agent as string,
      session_id: '',
      model: typeof value.model === 'string' ? value.model : undefined,
      timestamp: typeof value.ts === 'string' ? value.ts : undefined,
    },
  };
}

export function parseTranscriptJsonl(rawJsonl: string): TranscriptParseResult {
  const entries: TranscriptJsonLine[] = [];
  const lines = rawJsonl.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line) as unknown;
      if (isNormalizedTranscriptLine(parsed)) {
        entries.push(normalizedTranscriptLineToTimelineEntry(parsed, entries.length));
        continue;
      }
      if (!isTranscriptJsonLine(parsed)) {
        return {
          entries,
          error: `Line ${index + 1} is not a transcript JSONL row.`,
        };
      }
      entries.push(parsed);
    } catch (error) {
      return {
        entries,
        error: `Line ${index + 1} is invalid JSON: ${(error as Error).message}`,
      };
    }
  }

  return { entries };
}

export function flattenFileNodes(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      files.push(node);
    } else if (node.children) {
      files.push(...flattenFileNodes(node.children));
    }
  }
  return files;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function findFilePathBySuffix(
  nodes: readonly FileNode[],
  suffixes: readonly string[],
): string | undefined {
  const files = flattenFileNodes(nodes);
  for (const suffix of suffixes) {
    const match = files.find((file) => {
      const normalized = normalizePath(file.path);
      return normalized === suffix || normalized.endsWith(`/${suffix}`);
    });
    if (match) return match.path;
  }
  return undefined;
}

export function findTranscriptPath(nodes: readonly FileNode[]): string | undefined {
  return findFilePathBySuffix(nodes, ['transcript.jsonl']);
}

export function findAnswerPath(nodes: readonly FileNode[]): string | undefined {
  return findFilePathBySuffix(nodes, ['outputs/answer.md']);
}

function formatDurationMs(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatCurrency(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number') return undefined;
  return `$${value.toFixed(4)}`;
}

function formatTokenUsage(value: TokenUsageWire | undefined): string | undefined {
  if (!value) return undefined;
  const parts: string[] = [];
  if (typeof value.input === 'number') parts.push(`${value.input} in`);
  if (typeof value.output === 'number') parts.push(`${value.output} out`);
  if (typeof value.reasoning === 'number') parts.push(`${value.reasoning} reasoning`);
  if (typeof value.cached === 'number') parts.push(`${value.cached} cached`);
  return parts.length > 0 ? parts.join(' / ') : undefined;
}

function formatUnknown(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatContent(value: unknown): string {
  if (Array.isArray(value)) {
    const textBlocks = value
      .map((block) => {
        if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
          return block.text;
        }
        if (isRecord(block) && block.type === 'thinking' && typeof block.text === 'string') {
          return `Thinking:\n${block.text}`;
        }
        if (isRecord(block) && block.type === 'image' && typeof block.source === 'string') {
          return `Image: ${block.source}`;
        }
        return undefined;
      })
      .filter((text): text is string => text !== undefined);
    if (textBlocks.length > 0) {
      return textBlocks.join('\n');
    }
  }
  return formatUnknown(value);
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function pickPayload(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function nestedRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function toolCallName(call: Record<string, unknown>, index: number): string {
  const functionRecord = nestedRecord(call, 'function');
  return (
    pickString(call, ['tool', 'name', 'tool_name']) ??
    (functionRecord ? pickString(functionRecord, ['name']) : undefined) ??
    `Tool ${index + 1}`
  );
}

function toolCallInput(call: Record<string, unknown>): unknown {
  const functionRecord = nestedRecord(call, 'function');
  return (
    pickPayload(call, ['input', 'arguments', 'args', 'parameters']) ??
    (functionRecord ? pickPayload(functionRecord, ['arguments']) : undefined)
  );
}

function toolCallOutput(call: Record<string, unknown>): unknown {
  return pickPayload(call, ['output', 'result', 'content']);
}

function transcriptMessageId(line: TranscriptJsonLine, ordinal: number): string {
  return `${line.message_index}-${line.role}-${ordinal}`;
}

function buildTranscriptViewModel(
  entries: readonly TranscriptJsonLine[],
): TranscriptMessageViewModel[] {
  return [...entries]
    .sort((first, second) => first.message_index - second.message_index)
    .map((line, ordinal) => {
      const roleStyle = ROLE_STYLES[line.role] ?? {
        container: 'border-gray-800 bg-gray-900',
        badge: 'border-gray-700 bg-gray-800 text-gray-300',
        label: line.role,
        accent: 'text-gray-300',
      };
      const id = transcriptMessageId(line, ordinal);
      const toolCalls = (
        Array.isArray(line.tool_calls) ? line.tool_calls.filter(isRecord) : []
      ).map((call, index) => {
        const callId = pickString(call, ['id', 'call_id', 'tool_call_id']);
        return {
          id: `${id}-tool-${callId ?? index}`,
          call,
          index,
          name: toolCallName(call, index),
          status: pickString(call, ['status']),
          duration:
            typeof call.duration_ms === 'number' ? formatDurationMs(call.duration_ms) : undefined,
        };
      });

      return {
        id,
        anchorId: `message-${ordinal + 1}`,
        line,
        ordinal,
        roleStyle,
        content: formatContent(line.content),
        duration: formatDurationMs(line.duration_ms),
        tokenUsage: formatTokenUsage(line.token_usage),
        toolCalls,
      };
    });
}

function defaultExpandedMessageIds(messages: readonly TranscriptMessageViewModel[]): Set<string> {
  const ids = new Set<string>();
  if (messages[0]) ids.add(messages[0].id);
  const finalMessage = messages[messages.length - 1];
  if (finalMessage) ids.add(finalMessage.id);
  return ids;
}

function summarizeRoleCounts(messages: readonly TranscriptMessageViewModel[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message.line.role, (counts.get(message.line.role) ?? 0) + 1);
  }
  return counts;
}

function summarizeToolCounts(messages: readonly TranscriptMessageViewModel[]): {
  total: number;
  byName: Map<string, number>;
} {
  const byName = new Map<string, number>();
  let total = 0;
  for (const message of messages) {
    for (const call of message.toolCalls) {
      total += 1;
      byName.set(call.name, (byName.get(call.name) ?? 0) + 1);
    }
  }
  return { total, byName };
}

function hasValue(value: unknown): boolean {
  return (
    value !== undefined && value !== null && !(typeof value === 'string' && value.length === 0)
  );
}

function JsonBlock({
  label,
  value,
  tone = 'default',
}: { label: string; value: unknown; tone?: 'default' | 'error' }) {
  if (!hasValue(value)) return null;
  return (
    <div className="space-y-1">
      <div
        className={
          tone === 'error'
            ? 'text-xs font-medium text-red-300'
            : 'text-xs font-medium text-gray-400'
        }
      >
        {label}
      </div>
      <pre className="max-h-80 overflow-auto rounded-md border border-gray-800 bg-gray-950 p-3 text-xs text-gray-200">
        <code>{formatUnknown(value)}</code>
      </pre>
    </div>
  );
}

function MetadataPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-gray-800 bg-gray-950 px-2 py-0.5 text-xs text-gray-400">
      {children}
    </span>
  );
}

function ActionLink({
  href,
  children,
  download = false,
}: { href?: string; children: ReactNode; download?: boolean }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      download={download}
      className="rounded-md px-3 py-1.5 text-sm text-cyan-400 transition-colors hover:text-cyan-300 hover:underline"
    >
      {children}
    </a>
  );
}

function OpenFileButton({
  path,
  onOpenFile,
  children,
}: { path?: string; onOpenFile?: (path: string) => void; children: ReactNode }) {
  if (!path || !onOpenFile) return null;
  return (
    <button
      type="button"
      onClick={() => onOpenFile(path)}
      className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-cyan-900/60 hover:text-cyan-300"
    >
      {children}
    </button>
  );
}

function ToolCallDetails({
  toolCall,
  expanded,
  onToggle,
}: {
  toolCall: ToolCallViewModel;
  expanded: boolean;
  onToggle: (toolCallId: string, expanded: boolean) => void;
}) {
  const { call, index, name, status, duration } = toolCall;
  const callId = pickString(call, ['id', 'call_id', 'tool_call_id']);
  const metadata = isRecord(call.metadata) ? call.metadata : undefined;

  return (
    <details
      className="rounded-md border border-gray-800 bg-gray-950/80 p-3"
      open={expanded}
      data-testid={`tool-call-${callId ?? index}`}
      data-expanded={expanded ? 'true' : 'false'}
      onToggle={(event: SyntheticEvent<HTMLDetailsElement>) =>
        onToggle(toolCall.id, event.currentTarget.open)
      }
    >
      <summary className="cursor-pointer list-none text-sm font-medium text-gray-200">
        <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{expanded ? '-' : '+'}</span>
          <span>Tool call</span>
          <span className="rounded-md border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-300">
            {name}
          </span>
          {status && <span className="text-xs text-gray-500">{status}</span>}
          {duration && <span className="tabular-nums text-xs text-gray-500">{duration}</span>}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {callId && <MetadataPill>id: {callId}</MetadataPill>}
          {duration && <MetadataPill>duration: {duration}</MetadataPill>}
          {status && <MetadataPill>status: {status}</MetadataPill>}
        </div>
        <JsonBlock label="Arguments" value={toolCallInput(call)} />
        <JsonBlock label="Result" value={toolCallOutput(call)} />
        <JsonBlock label="Error" value={call.error} tone="error" />
        <JsonBlock label="Metadata" value={metadata} />
      </div>
    </details>
  );
}

function ToolResultDetails({ line }: { line: TranscriptJsonLine }) {
  const duration = formatDurationMs(line.duration_ms);
  const tokenUsage = formatTokenUsage(line.token_usage);
  return (
    <details className="rounded-md border border-amber-900/50 bg-gray-950/60 p-3">
      <summary className="cursor-pointer text-sm font-medium text-amber-300">
        {line.name ? `Tool result · ${line.name}` : 'Tool result'}
        {duration && <span className="ml-2 tabular-nums text-xs text-gray-500">{duration}</span>}
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {line.name && <MetadataPill>name: {line.name}</MetadataPill>}
          {duration && <MetadataPill>duration: {duration}</MetadataPill>}
          {tokenUsage && <MetadataPill>tokens: {tokenUsage}</MetadataPill>}
        </div>
        <JsonBlock label="Result" value={line.content} />
        <JsonBlock label="Metadata" value={line.metadata} />
      </div>
    </details>
  );
}

function TranscriptMessageCard({
  message,
  expanded,
  expandedToolIds,
  onToggleMessage,
  onToggleTool,
}: {
  message: TranscriptMessageViewModel;
  expanded: boolean;
  expandedToolIds: ReadonlySet<string>;
  onToggleMessage: (messageId: string, expanded: boolean) => void;
  onToggleTool: (toolCallId: string, expanded: boolean) => void;
}) {
  const { line, ordinal, roleStyle, content, duration, tokenUsage, toolCalls } = message;

  return (
    <details
      id={message.anchorId}
      className={`scroll-mt-6 rounded-lg border ${roleStyle.container}`}
      open={expanded}
      data-testid={`message-row-${ordinal + 1}`}
      data-expanded={expanded ? 'true' : 'false'}
      onToggle={(event: SyntheticEvent<HTMLDetailsElement>) =>
        onToggleMessage(message.id, event.currentTarget.open)
      }
    >
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">{expanded ? '-' : '+'}</span>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-medium ${roleStyle.badge}`}
            >
              {roleStyle.label}
            </span>
            {line.name && (
              <span className={`truncate text-sm font-medium ${roleStyle.accent}`}>
                {line.name}
              </span>
            )}
            {toolCalls.length > 0 && (
              <span className="rounded-md border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-300">
                {toolCalls.length} tool {toolCalls.length === 1 ? 'call' : 'calls'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <a
              href={`#${message.anchorId}`}
              className="tabular-nums text-gray-400 hover:text-cyan-300 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              #{ordinal + 1}
            </a>
            {line.start_time && <span>{line.start_time}</span>}
            {duration && <span className="tabular-nums">{duration}</span>}
            {tokenUsage && <span>{tokenUsage}</span>}
          </div>
        </div>
      </summary>

      <div className="space-y-3 border-t border-gray-800/70 px-4 py-3">
        {line.role === 'tool' || line.role === 'function' ? (
          <ToolResultDetails line={line} />
        ) : content.trim().length > 0 ? (
          <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-200">
            {content}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">No message content recorded.</p>
        )}

        {toolCalls.length > 0 && (
          <div className="space-y-2">
            {toolCalls.map((call) => (
              <ToolCallDetails
                key={call.id}
                toolCall={call}
                expanded={expandedToolIds.has(call.id)}
                onToggle={onToggleTool}
              />
            ))}
          </div>
        )}

        {line.metadata && line.role !== 'tool' && line.role !== 'function' && (
          <details className="rounded-md border border-gray-800 bg-gray-950/60 p-3">
            <summary className="cursor-pointer text-xs font-medium text-gray-400">
              Message metadata
            </summary>
            <div className="mt-3">
              <JsonBlock label="Metadata" value={line.metadata} />
            </div>
          </details>
        )}
      </div>
    </details>
  );
}

function TranscriptSummary({
  messages,
  transcriptPath,
}: { messages: readonly TranscriptMessageViewModel[]; transcriptPath?: string }) {
  const first = messages[0]?.line;
  const provider = first?.source?.provider ?? first?.agent;
  const model = first?.source?.model ?? first?.model;
  const sessionId = first?.source?.session_id;
  const duration = formatDurationMs(first?.transcript_duration_ms);
  const tokenUsage = formatTokenUsage(first?.transcript_token_usage);
  const cost = formatCurrency(first?.transcript_cost_usd);
  const roleCounts = summarizeRoleCounts(messages);
  const toolCounts = summarizeToolCounts(messages);

  return (
    <div className="flex flex-wrap gap-2">
      <MetadataPill>{messages.length} messages</MetadataPill>
      {Array.from(roleCounts.entries()).map(([role, count]) => (
        <MetadataPill key={role}>
          {role}: {count}
        </MetadataPill>
      ))}
      {toolCounts.total > 0 && <MetadataPill>{toolCounts.total} tool calls</MetadataPill>}
      {Array.from(toolCounts.byName.entries()).map(([name, count]) => (
        <MetadataPill key={name}>
          {name}: {count}
        </MetadataPill>
      ))}
      {provider && <MetadataPill>provider: {provider}</MetadataPill>}
      {model && <MetadataPill>model: {model}</MetadataPill>}
      {sessionId && <MetadataPill>session: {sessionId}</MetadataPill>}
      {duration && <MetadataPill>duration: {duration}</MetadataPill>}
      {tokenUsage && <MetadataPill>tokens: {tokenUsage}</MetadataPill>}
      {cost && <MetadataPill>cost: {cost}</MetadataPill>}
      {transcriptPath && <MetadataPill>{transcriptPath}</MetadataPill>}
    </div>
  );
}

function filterTranscriptMessages(
  messages: readonly TranscriptMessageViewModel[],
  filter: TranscriptFilter,
): TranscriptMessageViewModel[] {
  switch (filter) {
    case 'messages':
      return messages.filter(
        (message) => message.line.role !== 'tool' && message.line.role !== 'function',
      );
    case 'with-tools':
      return messages.filter((message) => message.toolCalls.length > 0);
    case 'tool-results':
      return messages.filter(
        (message) => message.line.role === 'tool' || message.line.role === 'function',
      );
    case 'all':
      return [...messages];
  }
}

function FilterButton({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean;
  count: number;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-md border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-sm text-cyan-200'
          : 'rounded-md border border-gray-800 bg-gray-950 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200'
      }
    >
      {children}
      <span className="ml-2 text-xs text-gray-500">{count}</span>
    </button>
  );
}

export function TranscriptTimeline({
  entries,
  finalAnswer,
  answerPath,
  transcriptPath,
  answerHref,
  transcriptHref,
  transcriptDownloadHref,
  onOpenFile,
}: TranscriptTimelineProps) {
  const messages = useMemo(() => buildTranscriptViewModel(entries), [entries]);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() =>
    defaultExpandedMessageIds(messages),
  );
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<TranscriptFilter>('all');
  const hasCanonicalAnswer = !!answerPath;
  const allToolIds = useMemo(
    () => messages.flatMap((message) => message.toolCalls.map((toolCall) => toolCall.id)),
    [messages],
  );
  const visibleMessages = useMemo(
    () => filterTranscriptMessages(messages, filter),
    [messages, filter],
  );
  const messageCount = messages.filter(
    (message) => message.line.role !== 'tool' && message.line.role !== 'function',
  ).length;
  const toolResultCount = messages.filter(
    (message) => message.line.role === 'tool' || message.line.role === 'function',
  ).length;
  const withToolsCount = messages.filter((message) => message.toolCalls.length > 0).length;

  useEffect(() => {
    setExpandedMessageIds(defaultExpandedMessageIds(messages));
    setExpandedToolIds(new Set());
    setFilter('all');
  }, [messages]);

  function setMessageExpanded(messageId: string, expanded: boolean) {
    setExpandedMessageIds((current) => {
      const next = new Set(current);
      if (expanded) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      return next;
    });
  }

  function setToolExpanded(toolCallId: string, expanded: boolean) {
    setExpandedToolIds((current) => {
      const next = new Set(current);
      if (expanded) {
        next.add(toolCallId);
      } else {
        next.delete(toolCallId);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {hasCanonicalAnswer && (
        <section className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-emerald-300">Final answer</h3>
              <p className="mt-1 text-xs text-gray-500">
                Highlighted from canonical <code>outputs/answer.md</code>; transcript context stays
                below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <OpenFileButton path={answerPath} onOpenFile={onOpenFile}>
                Open answer.md in Files
              </OpenFileButton>
              <ActionLink href={answerHref}>Open answer.md</ActionLink>
            </div>
          </div>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-emerald-900/40 bg-gray-950/80 p-3 text-sm leading-6 text-gray-100">
            {finalAnswer && finalAnswer.trim().length > 0 ? finalAnswer : 'answer.md is empty.'}
          </pre>
        </section>
      )}

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-300">Transcript timeline</h3>
            <TranscriptSummary messages={messages} transcriptPath={transcriptPath} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OpenFileButton path={transcriptPath} onOpenFile={onOpenFile}>
              Open transcript.jsonl in Files
            </OpenFileButton>
            <ActionLink href={transcriptHref}>Open normalized JSONL</ActionLink>
            <ActionLink href={transcriptDownloadHref} download>
              Download normalized JSONL
            </ActionLink>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <FilterButton
              active={filter === 'all'}
              count={messages.length}
              onClick={() => setFilter('all')}
            >
              All
            </FilterButton>
            <FilterButton
              active={filter === 'messages'}
              count={messageCount}
              onClick={() => setFilter('messages')}
            >
              Messages
            </FilterButton>
            <FilterButton
              active={filter === 'with-tools'}
              count={withToolsCount}
              onClick={() => setFilter('with-tools')}
            >
              Has tools
            </FilterButton>
            <FilterButton
              active={filter === 'tool-results'}
              count={toolResultCount}
              onClick={() => setFilter('tool-results')}
            >
              Tool results
            </FilterButton>
          </div>
          {allToolIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setExpandedToolIds(new Set(allToolIds))}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-amber-800 hover:text-amber-200"
              >
                Expand all tool calls
              </button>
              <button
                type="button"
                onClick={() => setExpandedToolIds(new Set())}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
              >
                Collapse all tool calls
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="space-y-3">
        {visibleMessages.map((message) => (
          <TranscriptMessageCard
            key={message.id}
            message={message}
            expanded={expandedMessageIds.has(message.id)}
            expandedToolIds={expandedToolIds}
            onToggleMessage={setMessageExpanded}
            onToggleTool={setToolExpanded}
          />
        ))}
      </div>
    </div>
  );
}
