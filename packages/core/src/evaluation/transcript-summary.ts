import { normalizeToolCall } from './providers/normalize-tool-call.js';
import {
  KNOWN_PROVIDERS,
  type Message,
  type ProviderKind,
  type ToolCall,
} from './providers/types.js';

export const CANONICAL_TRANSCRIPT_TOOL_NAMES = [
  'file_read',
  'file_write',
  'file_edit',
  'shell',
  'web_fetch',
  'web_search',
  'glob',
  'grep',
  'list_dir',
  'agent_task',
  'unknown',
] as const;

export type CanonicalTranscriptToolName = (typeof CANONICAL_TRANSCRIPT_TOOL_NAMES)[number];

export interface TranscriptSummaryErrorWire {
  readonly message: string;
  readonly tool_call_id?: string;
  readonly tool_name?: CanonicalTranscriptToolName;
}

export interface TranscriptSummaryWire {
  readonly total_turns: number;
  readonly tool_calls: Record<CanonicalTranscriptToolName, number>;
  readonly files_read: readonly string[];
  readonly files_modified: readonly string[];
  readonly shell_commands: readonly string[];
  readonly web_fetches: readonly string[];
  readonly errors: readonly TranscriptSummaryErrorWire[];
  readonly thinking_blocks: number;
}

const PROVIDER_ALIASES: Readonly<Record<string, ProviderKind>> = {
  codex: 'codex-cli',
  'codex-cli': 'codex-cli',
  'codex-app-server': 'codex-app-server',
  'codex-sdk': 'codex-sdk',
  copilot: 'copilot-sdk',
  'copilot-cli': 'copilot-cli',
  'copilot-sdk': 'copilot-sdk',
  'copilot-log': 'copilot-log',
  pi: 'pi-cli',
  'pi-cli': 'pi-cli',
  'pi-coding-agent': 'pi-coding-agent',
  claude: 'claude',
  'claude-cli': 'claude-cli',
  'claude-sdk': 'claude-sdk',
  vscode: 'vscode',
  'vscode-insiders': 'vscode-insiders',
};

const LEGACY_TOOL_NAME_MAP: Readonly<Record<string, CanonicalTranscriptToolName>> = {
  Read: 'file_read',
  Write: 'file_write',
  Edit: 'file_edit',
  Bash: 'shell',
  Skill: 'agent_task',
};

const FILE_PATH_KEYS = new Set([
  'file',
  'filename',
  'filepath',
  'file_path',
  'path',
  'targetfile',
  'targetpath',
  'relativepath',
  '_extractedpath',
]);

const COMMAND_KEYS = new Set([
  'cmd',
  'command',
  'script',
  'shellcommand',
  'extractedcommand',
  '_extractedcommand',
]);

const URL_KEYS = new Set(['url', 'uri', 'href', 'extractedurl', '_extractedurl']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_]+/g, '').toLowerCase();
}

function normalizeProviderId(providerId: string | undefined): ProviderKind | undefined {
  if (!providerId) {
    return undefined;
  }
  const normalized = providerId.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if ((KNOWN_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as ProviderKind;
  }
  return PROVIDER_ALIASES[normalized];
}

function genericCanonicalToolName(toolName: string): CanonicalTranscriptToolName {
  const normalized = normalizedKey(toolName);
  if (
    normalized === 'file_read' ||
    normalized === 'read' ||
    normalized === 'readfile' ||
    normalized === 'read_file' ||
    normalized.includes('fileread') ||
    normalized === 'viewfile'
  ) {
    return 'file_read';
  }
  if (
    normalized === 'file_write' ||
    normalized === 'write' ||
    normalized === 'writefile' ||
    normalized === 'write_file' ||
    normalized.includes('filewrite') ||
    normalized === 'createfile'
  ) {
    return 'file_write';
  }
  if (
    normalized === 'file_edit' ||
    normalized === 'edit' ||
    normalized === 'editfile' ||
    normalized === 'edit_file' ||
    normalized.includes('fileedit') ||
    normalized.includes('filechange') ||
    normalized.includes('applypatch') ||
    normalized.includes('replaceinfile')
  ) {
    return 'file_edit';
  }
  if (
    normalized === 'bash' ||
    normalized === 'shell' ||
    normalized.includes('shell') ||
    normalized.includes('terminal') ||
    normalized.includes('commandexecution') ||
    normalized.includes('execcommand')
  ) {
    return 'shell';
  }
  if (
    normalized === 'web_search' ||
    normalized.includes('websearch') ||
    normalized === 'searchweb'
  ) {
    return 'web_search';
  }
  if (
    normalized === 'web_fetch' ||
    normalized.includes('webfetch') ||
    normalized.includes('fetchurl') ||
    normalized === 'fetch' ||
    normalized === 'fetchdoc' ||
    normalized === 'httpget'
  ) {
    return 'web_fetch';
  }
  if (normalized === 'glob' || normalized.includes('glob')) {
    return 'glob';
  }
  if (normalized === 'grep' || normalized.includes('grep') || normalized.includes('ripgrep')) {
    return 'grep';
  }
  if (
    normalized === 'list_dir' ||
    normalized.includes('listdir') ||
    normalized.includes('lsdir') ||
    normalized === 'ls'
  ) {
    return 'list_dir';
  }
  if (
    normalized === 'skill' ||
    normalized.includes('agenttask') ||
    normalized.includes('subagent') ||
    normalized.startsWith('mcp')
  ) {
    return 'agent_task';
  }
  return 'unknown';
}

export function canonicalTranscriptToolName(
  toolName: string | undefined,
  providerId?: string,
): CanonicalTranscriptToolName {
  if (!toolName) {
    return 'unknown';
  }
  const providerKind = normalizeProviderId(providerId);
  const providerNormalized = providerKind
    ? normalizeToolCall(providerKind, { tool: toolName })
    : undefined;
  const routedName = providerNormalized?.tool ?? toolName;
  return LEGACY_TOOL_NAME_MAP[routedName] ?? genericCanonicalToolName(routedName);
}

function emptyToolCallCounts(): Record<CanonicalTranscriptToolName, number> {
  return Object.fromEntries(
    CANONICAL_TRANSCRIPT_TOOL_NAMES.map((toolName) => [toolName, 0]),
  ) as Record<CanonicalTranscriptToolName, number>;
}

function stringValuesByKey(value: unknown, keys: ReadonlySet<string>, maxDepth = 6): string[] {
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
      if (keys.has(normalizedKey(key))) {
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

function firstStringByKey(value: unknown, keys: ReadonlySet<string>): string | undefined {
  return stringValuesByKey(value, keys)[0];
}

function parseModifiedPathsFromDiff(fileChanges: string | undefined): string[] {
  if (!fileChanges) {
    return [];
  }
  const paths = new Set<string>();
  const lines = fileChanges.split('\n');
  for (let index = 0; index < lines.length - 1; index++) {
    const oldLine = lines[index];
    const newLine = lines[index + 1];
    if (!oldLine.startsWith('--- a/') || !newLine?.startsWith('+++ b/')) {
      continue;
    }
    const filePath = newLine.slice('+++ b/'.length).trim();
    if (filePath && filePath !== '/dev/null') {
      paths.add(filePath);
    }
  }
  return [...paths];
}

function collectThinkingBlocks(messages: readonly Message[]): number {
  let count = 0;
  for (const message of messages) {
    const content = message.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const entry = block as unknown;
      if (!isRecord(entry)) {
        continue;
      }
      if (entry.type === 'thinking' || entry.type === 'reasoning') {
        count += 1;
      }
    }
  }
  return count;
}

function errorFromToolCall(
  toolCall: ToolCall,
  toolName: CanonicalTranscriptToolName,
): TranscriptSummaryErrorWire | undefined {
  if (
    toolCall.status !== 'error' &&
    toolCall.status !== 'timeout' &&
    toolCall.status !== 'cancelled'
  ) {
    return undefined;
  }
  const output = toolCall.output;
  const message =
    typeof output === 'string'
      ? output
      : isRecord(output) && typeof output.message === 'string'
        ? output.message
        : `Tool ${toolCall.tool} ${toolCall.status}`;
  return {
    message,
    ...(toolCall.id ? { tool_call_id: toolCall.id } : {}),
    tool_name: toolName,
  };
}

export function buildTranscriptSummary(params: {
  readonly messages: readonly Message[];
  readonly providerId?: string;
  readonly fileChanges?: string;
  readonly error?: string;
}): TranscriptSummaryWire {
  const toolCalls = emptyToolCallCounts();
  const filesRead = new Set<string>();
  const filesModified = new Set<string>(parseModifiedPathsFromDiff(params.fileChanges));
  const shellCommands: string[] = [];
  const webFetches: string[] = [];
  const errors: TranscriptSummaryErrorWire[] = [];

  for (const message of params.messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const toolName = canonicalTranscriptToolName(toolCall.tool, params.providerId);
      toolCalls[toolName] += 1;
      if (toolName === 'file_read') {
        for (const filePath of stringValuesByKey(toolCall.input, FILE_PATH_KEYS)) {
          filesRead.add(filePath);
        }
      } else if (toolName === 'file_write' || toolName === 'file_edit') {
        for (const filePath of stringValuesByKey(toolCall.input, FILE_PATH_KEYS)) {
          filesModified.add(filePath);
        }
      } else if (toolName === 'shell') {
        const command = firstStringByKey(toolCall.input, COMMAND_KEYS);
        if (command) {
          shellCommands.push(command);
        }
      } else if (toolName === 'web_fetch') {
        const url = firstStringByKey(toolCall.input, URL_KEYS);
        if (url) {
          webFetches.push(url);
        }
      }

      const toolError = errorFromToolCall(toolCall, toolName);
      if (toolError) {
        errors.push(toolError);
      }
    }
  }

  if (params.error) {
    errors.unshift({ message: params.error });
  }

  return {
    total_turns: params.messages.filter((message) =>
      ['system', 'user', 'assistant'].includes(message.role),
    ).length,
    tool_calls: toolCalls,
    files_read: [...filesRead],
    files_modified: [...filesModified],
    shell_commands: shellCommands,
    web_fetches: webFetches,
    errors,
    thinking_blocks: collectThinkingBlocks(params.messages),
  };
}
