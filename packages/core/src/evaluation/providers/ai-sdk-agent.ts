import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { getAgentvDataDir } from '../../paths.js';
import type { JsonObject } from '../types.js';
import { normalizeToolCall } from './normalize-tool-call.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import type { AiSdkAgentResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamCallbacks,
  ProviderTokenUsage,
  ProviderTool,
  ToolCall,
} from './types.js';

const DEFAULT_SYSTEM_PROMPT = [
  'You are an experimental coding agent running inside an AgentV eval workspace.',
  'Use the provided tools to inspect and modify files. All file paths are relative to the workspace root.',
  'Prefer exact edits over full rewrites when changing existing files. Use bash only when it helps verify the work.',
  'When the task is complete, respond with a concise summary of the files changed and checks run.',
].join(' ');

const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'] as const;
const SUPPORTED_TOOLS = new Set<string>(DEFAULT_TOOLS);
const DEFAULT_BASH_TIMEOUT_MS = 60_000;
const MAX_BASH_TIMEOUT_MS = 120_000;
const MAX_FILE_BYTES = 200_000;
const MAX_BASH_OUTPUT_BYTES = 200_000;
const MANAGED_DEPENDENCIES = ['ai@^6.0.0', '@ai-sdk/openai@^3.0.0'] as const;

type AiSdkToolName = (typeof DEFAULT_TOOLS)[number];

interface AiSdkCoreModule {
  generateText(options: Record<string, unknown>): Promise<AiGenerateTextResult>;
  stepCountIs(stepCount: number): unknown;
  tool(definition: Record<string, unknown>): unknown;
  jsonSchema(schema: unknown): unknown;
}

interface AiOpenAIProvider {
  (modelId: string): unknown;
  chat?: (modelId: string) => unknown;
}

interface AiSdkOpenAIModule {
  createOpenAI(options?: {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    name?: string;
  }): AiOpenAIProvider;
}

interface AiSdkModules {
  readonly ai: AiSdkCoreModule;
  readonly openai: AiSdkOpenAIModule;
}

interface AiGenerateTextResult {
  readonly text?: string;
  readonly content?: unknown;
  readonly toolCalls?: readonly AiToolCall[];
  readonly toolResults?: readonly AiToolResult[];
  readonly finishReason?: string;
  readonly rawFinishReason?: string;
  readonly usage?: AiUsage;
  readonly totalUsage?: AiUsage;
  readonly warnings?: unknown;
  readonly request?: unknown;
  readonly response?: unknown;
  readonly providerMetadata?: unknown;
  readonly steps?: readonly AiStepResult[];
}

interface AiStepResult {
  readonly text?: string;
  readonly toolCalls?: readonly AiToolCall[];
  readonly toolResults?: readonly AiToolResult[];
  readonly usage?: AiUsage;
  readonly finishReason?: string;
  readonly rawFinishReason?: string;
  readonly response?: unknown;
}

interface AiToolCall {
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly input?: unknown;
}

interface AiToolResult {
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly input?: unknown;
  readonly output?: unknown;
}

interface AiUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
  readonly inputTokenDetails?: {
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
  };
  readonly outputTokenDetails?: {
    readonly reasoningTokens?: number;
  };
  readonly raw?: unknown;
}

interface BashResult {
  readonly command: string;
  readonly exit_code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly duration_ms: number;
  readonly timed_out: boolean;
  readonly truncated: boolean;
}

let sdkModules: AiSdkModules | null = null;
let loadingPromise: Promise<void> | null = null;
let loaderOverride: (() => Promise<AiSdkModules>) | undefined;

function findManagedSdkInstallRoot(): string {
  return path.join(getAgentvDataDir(), 'deps', 'ai-sdk-agent');
}

function findAccessiblePath(paths: readonly string[]): string | undefined {
  for (const candidate of paths) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {}
  }
  return undefined;
}

function coerceModules(aiModule: unknown, openaiModule: unknown): AiSdkModules | undefined {
  const ai = aiModule as Partial<AiSdkCoreModule>;
  const openai = openaiModule as Partial<AiSdkOpenAIModule>;
  if (
    typeof ai.generateText !== 'function' ||
    typeof ai.stepCountIs !== 'function' ||
    typeof ai.tool !== 'function' ||
    typeof ai.jsonSchema !== 'function' ||
    typeof openai.createOpenAI !== 'function'
  ) {
    return undefined;
  }
  return {
    ai: ai as AiSdkCoreModule,
    openai: openai as AiSdkOpenAIModule,
  };
}

async function tryImportLocalSdkModules(): Promise<boolean> {
  try {
    const [aiModule, openaiModule] = await Promise.all([import('ai'), import('@ai-sdk/openai')]);
    const modules = coerceModules(aiModule, openaiModule);
    if (!modules) return false;
    sdkModules = modules;
    return true;
  } catch {
    return false;
  }
}

async function tryImportManagedSdkModules(): Promise<boolean> {
  const managedRoot = findManagedSdkInstallRoot();
  const aiEntry = findAccessiblePath([
    path.join(managedRoot, 'node_modules', 'ai', 'dist', 'index.mjs'),
    path.join(managedRoot, 'node_modules', 'ai', 'dist', 'index.js'),
  ]);
  const openaiEntry = findAccessiblePath([
    path.join(managedRoot, 'node_modules', '@ai-sdk', 'openai', 'dist', 'index.mjs'),
    path.join(managedRoot, 'node_modules', '@ai-sdk', 'openai', 'dist', 'index.js'),
  ]);
  if (!aiEntry || !openaiEntry) return false;

  try {
    const [aiModule, openaiModule] = await Promise.all([
      import(pathToFileURL(aiEntry).href),
      import(pathToFileURL(openaiEntry).href),
    ]);
    const modules = coerceModules(aiModule, openaiModule);
    if (!modules) return false;
    sdkModules = modules;
    return true;
  } catch {
    return false;
  }
}

function installManagedSdkModules(installDir: string): void {
  mkdirSync(installDir, { recursive: true });
  const packageJsonPath = path.join(installDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    writeFileSync(
      packageJsonPath,
      `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
      'utf8',
    );
  }

  const bunExecutable = process.versions.bun ? process.execPath : 'bun';
  console.error(
    `Installing ai-sdk-agent dependencies into ${installDir} with bun: ${MANAGED_DEPENDENCIES.join(
      ' ',
    )}`,
  );
  execFileSync(bunExecutable, ['add', ...MANAGED_DEPENDENCIES], {
    cwd: installDir,
    stdio: 'inherit',
  });
}

function formatDependencyLoadError(error: unknown): string {
  const managedRoot = findManagedSdkInstallRoot();
  const message = error instanceof Error ? error.message : String(error);
  return [
    'ai-sdk-agent requires the Vercel AI SDK packages `ai` and `@ai-sdk/openai`.',
    `AgentV tried local imports first, then the managed install directory: ${managedRoot}`,
    'Repair with:',
    `  mkdir -p ${managedRoot}`,
    `  cd ${managedRoot}`,
    `  bun add ${MANAGED_DEPENDENCIES.join(' ')}`,
    `Original error: ${message}`,
  ].join('\n');
}

async function doLoadSdkModules(): Promise<void> {
  if (loaderOverride) {
    sdkModules = await loaderOverride();
    return;
  }
  if ((await tryImportLocalSdkModules()) || (await tryImportManagedSdkModules())) {
    return;
  }

  const installDir = findManagedSdkInstallRoot();
  try {
    installManagedSdkModules(installDir);
    if (await tryImportManagedSdkModules()) {
      return;
    }
    throw new Error('managed install completed but modules still could not be imported');
  } catch (error) {
    throw new Error(formatDependencyLoadError(error));
  }
}

async function loadSdkModules(): Promise<AiSdkModules> {
  if (!sdkModules) {
    if (!loadingPromise) {
      loadingPromise = doLoadSdkModules().catch((error) => {
        loadingPromise = null;
        throw error;
      });
    }
    await loadingPromise;
  }
  return sdkModules as AiSdkModules;
}

export class AiSdkAgentProvider implements Provider {
  readonly id: string;
  readonly kind = 'ai-sdk-agent' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: AiSdkAgentResolvedConfig;
  private readonly toolAllowlist: readonly AiSdkToolName[];

  constructor(targetName: string, config: AiSdkAgentResolvedConfig) {
    this.id = `ai-sdk-agent:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.toolAllowlist = parseToolAllowlist(config.tools);
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('ai-sdk-agent request was aborted before execution');
    }

    const sdk = await loadSdkModules();
    const cwd = this.resolveCwd(request.cwd);
    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const toolCalls: ToolCall[] = [];
    const providerTools = createCodingTools(cwd, this.toolAllowlist);
    const tools = toAiSdkToolSet(sdk, providerTools, {
      onToolCall: (toolCall) => {
        toolCalls.push(toolCall);
      },
      callbacks: request.streamCallbacks,
    });

    const openai = sdk.openai.createOpenAI({
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      name: 'agentv-ai-sdk-agent',
    });
    const model =
      typeof openai.chat === 'function'
        ? openai.chat(this.config.model)
        : openai(this.config.model);

    const inputFiles = normalizeInputFiles(request.inputFiles);
    const prompt = buildPromptDocument(request, inputFiles);
    const system = buildSystemPrompt(this.config.systemPrompt, request.systemPrompt);
    const temperature = request.temperature ?? this.config.temperature;
    const maxOutputTokens = request.maxOutputTokens;

    const result = await sdk.ai.generateText({
      model,
      system,
      prompt,
      tools,
      stopWhen: sdk.ai.stepCountIs(this.config.maxSteps),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(this.config.timeoutMs !== undefined ? { timeout: this.config.timeoutMs } : {}),
      ...(request.signal ? { abortSignal: request.signal } : {}),
    });

    const endTime = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    return mapAiSdkResponse(result, {
      model: this.config.model,
      baseURL: this.config.baseURL,
      maxSteps: this.config.maxSteps,
      toolAllowlist: this.toolAllowlist,
      observedToolCalls: toolCalls,
      durationMs,
      startTime,
      endTime,
    });
  }

  private resolveCwd(cwdOverride?: string): string {
    if (cwdOverride) {
      return path.resolve(cwdOverride);
    }
    if (this.config.cwd) {
      return path.resolve(this.config.cwd);
    }
    return process.cwd();
  }
}

function buildSystemPrompt(configSystemPrompt?: string, requestSystemPrompt?: string): string {
  return [DEFAULT_SYSTEM_PROMPT, configSystemPrompt, requestSystemPrompt]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join('\n\n');
}

function parseToolAllowlist(value: string | undefined): readonly AiSdkToolName[] {
  if (!value || value.trim().length === 0) {
    return DEFAULT_TOOLS;
  }

  const selected: AiSdkToolName[] = [];
  for (const raw of value.split(',')) {
    const name = raw.trim().toLowerCase();
    if (name.length === 0) continue;
    if (!SUPPORTED_TOOLS.has(name)) {
      throw new Error(
        `ai-sdk-agent tools includes unsupported tool '${name}'. Supported tools: ${DEFAULT_TOOLS.join(
          ',',
        )}`,
      );
    }
    if (!selected.includes(name as AiSdkToolName)) {
      selected.push(name as AiSdkToolName);
    }
  }

  if (selected.length === 0) {
    throw new Error('ai-sdk-agent tools allowlist cannot be empty');
  }
  return selected;
}

function toAiSdkToolSet(
  sdk: AiSdkModules,
  providerTools: readonly ProviderTool[],
  options: {
    readonly onToolCall: (toolCall: ToolCall) => void;
    readonly callbacks?: ProviderStreamCallbacks;
  },
): Record<string, unknown> {
  const toolSet: Record<string, unknown> = {};
  for (const providerTool of providerTools) {
    toolSet[providerTool.name] = sdk.ai.tool({
      description: providerTool.description,
      inputSchema: sdk.ai.jsonSchema(providerTool.parameters),
      execute: async (input: unknown, executionOptions?: { toolCallId?: string }) => {
        const toolCallId = executionOptions?.toolCallId ?? randomUUID();
        const startTime = new Date().toISOString();
        const startMs = Date.now();
        options.callbacks?.onToolCallStart?.(providerTool.name, toolCallId);

        let output: unknown;
        let status: ToolCall['status'] = 'ok';
        try {
          output = await providerTool.execute(input);
          if (isToolErrorResult(output)) {
            status = output.status ?? 'error';
          }
        } catch (error) {
          output = { error: error instanceof Error ? error.message : String(error) };
          status = 'error';
        }

        const endMs = Date.now();
        const toolCall = normalizeToolCall('ai-sdk-agent', {
          tool: providerTool.name,
          input,
          output,
          id: toolCallId,
          startTime,
          endTime: new Date().toISOString(),
          durationMs: endMs - startMs,
          status,
        });
        options.onToolCall(toolCall);
        options.callbacks?.onToolCallEnd?.(
          providerTool.name,
          input,
          output,
          toolCall.durationMs ?? 0,
          toolCallId,
        );
        return output;
      },
    });
  }
  return toolSet;
}

function isToolErrorResult(
  value: unknown,
): value is { error: unknown; status?: ToolCall['status'] } {
  return typeof value === 'object' && value !== null && 'error' in value;
}

function createCodingTools(
  workspacePath: string,
  allowlist: readonly AiSdkToolName[] = DEFAULT_TOOLS,
): ProviderTool[] {
  const tools: Record<AiSdkToolName, ProviderTool> = {
    read: {
      name: 'read',
      description:
        'Read a UTF-8 file relative to the workspace. Returns content, byte size, and whether output was truncated.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root.' },
          file_path: { type: 'string', description: 'Alias for path.' },
        },
        anyOf: [{ required: ['path'] }, { required: ['file_path'] }],
      },
      execute: async (input) => {
        const relPath = requiredPath(input);
        const resolved = resolveWorkspacePath(workspacePath, relPath);
        const fileStat = await stat(resolved);
        if (fileStat.isDirectory()) {
          return { error: `'${relPath}' is a directory, not a file`, status: 'error' };
        }
        const fd = await open(resolved, 'r');
        try {
          const bytesToRead = Math.min(fileStat.size, MAX_FILE_BYTES);
          const buffer = Buffer.alloc(bytesToRead);
          await fd.read(buffer, 0, bytesToRead, 0);
          return {
            path: relPath,
            content: buffer.toString('utf8'),
            bytes: fileStat.size,
            truncated: fileStat.size > MAX_FILE_BYTES,
          };
        } finally {
          await fd.close();
        }
      },
    },
    write: {
      name: 'write',
      description: 'Write UTF-8 content to a file relative to the workspace, creating parent dirs.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root.' },
          file_path: { type: 'string', description: 'Alias for path.' },
          content: { type: 'string', description: 'Full file contents to write.' },
        },
        required: ['content'],
        anyOf: [{ required: ['path'] }, { required: ['file_path'] }],
      },
      execute: async (input) => {
        const relPath = requiredPath(input);
        const content = requiredString(input, 'content');
        const resolved = resolveWorkspacePath(workspacePath, relPath);
        await mkdir(path.dirname(resolved), { recursive: true });
        await writeFile(resolved, content, 'utf8');
        return {
          path: relPath,
          bytes_written: Buffer.byteLength(content, 'utf8'),
        };
      },
    },
    edit: {
      name: 'edit',
      description:
        'Replace an exact string in a UTF-8 file relative to the workspace. By default the old string must appear exactly once; set replace_all true to replace every occurrence.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root.' },
          file_path: { type: 'string', description: 'Alias for path.' },
          old_string: { type: 'string', description: 'Exact text to replace.' },
          new_string: { type: 'string', description: 'Replacement text.' },
          replace_all: {
            type: 'boolean',
            description: 'Replace all occurrences instead of requiring exactly one.',
          },
        },
        required: ['old_string', 'new_string'],
        anyOf: [{ required: ['path'] }, { required: ['file_path'] }],
      },
      execute: async (input) => {
        const relPath = requiredPath(input);
        const oldString = requiredString(input, 'old_string');
        const newString = requiredString(input, 'new_string');
        const replaceAll = optionalBoolean(input, 'replace_all') ?? false;
        if (oldString.length === 0) {
          return { error: 'old_string must not be empty', status: 'error' };
        }

        const resolved = resolveWorkspacePath(workspacePath, relPath);
        const original = await readFile(resolved, 'utf8');
        const occurrences = countOccurrences(original, oldString);
        if (occurrences === 0) {
          return { error: 'old_string was not found', status: 'error' };
        }
        if (!replaceAll && occurrences !== 1) {
          return {
            error: `old_string matched ${occurrences} times; provide a more specific string or set replace_all true`,
            status: 'error',
          };
        }

        const updated = replaceAll
          ? original.split(oldString).join(newString)
          : original.replace(oldString, newString);
        await writeFile(resolved, updated, 'utf8');
        return { path: relPath, replacements: replaceAll ? occurrences : 1 };
      },
    },
    bash: {
      name: 'bash',
      description:
        'Run a shell command in the workspace with timeout and bounded stdout/stderr capture.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run in the workspace.' },
          timeout_seconds: {
            type: 'number',
            description: `Optional timeout, capped at ${MAX_BASH_TIMEOUT_MS / 1000} seconds.`,
          },
        },
        required: ['command'],
      },
      execute: async (input) => {
        const command = requiredString(input, 'command');
        const timeoutSeconds = optionalNumber(input, 'timeout_seconds');
        const timeoutMs =
          timeoutSeconds === undefined
            ? DEFAULT_BASH_TIMEOUT_MS
            : Math.min(Math.max(Math.floor(timeoutSeconds * 1000), 1), MAX_BASH_TIMEOUT_MS);
        return runBashCommand(command, { cwd: workspacePath, timeoutMs });
      },
    },
  };

  return allowlist.map((name) => tools[name]);
}

function requiredPath(input: unknown): string {
  const args = asRecord(input);
  const value = args.path ?? args.file_path ?? args.filePath;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('path is required');
  }
  return value.trim();
}

function requiredString(input: unknown, key: string): string {
  const value = asRecord(input)[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalNumber(input: unknown, key: string): number | undefined {
  const value = asRecord(input)[key];
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${key} must be a number`);
  }
  return numeric;
}

function optionalBoolean(input: unknown, key: string): boolean | undefined {
  const value = asRecord(input)[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`${key} must be a boolean`);
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function resolveWorkspacePath(workspacePath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Path '${relativePath}' must be relative to the workspace`);
  }
  const root = path.resolve(workspacePath);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path '${relativePath}' is outside the workspace`);
  }
  return resolved;
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    index = value.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}

function isBenignPipeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

function runBashCommand(
  command: string,
  options: { readonly cwd: string; readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<BashResult> {
  const startedAt = Date.now();
  const detached = process.platform !== 'win32';

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached,
    });

    const stdout = new BoundedBuffer(MAX_BASH_OUTPUT_BYTES);
    const stderr = new BoundedBuffer(MAX_BASH_OUTPUT_BYTES);
    let timedOut = false;
    let childError: Error | undefined;
    let settled = false;

    const killChild = () => {
      try {
        if (detached && child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killChild();
    }, options.timeoutMs);
    timeout.unref?.();

    const abortHandler = () => {
      timedOut = true;
      killChild();
    };
    options.signal?.addEventListener('abort', abortHandler, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk));
    child.stdout?.on('error', (error) => {
      if (!isBenignPipeError(error)) {
        stderr.append(Buffer.from(`stdout error: ${(error as Error).message}\n`));
      }
    });
    child.stderr?.on('error', (error) => {
      if (!isBenignPipeError(error)) {
        stderr.append(Buffer.from(`stderr error: ${(error as Error).message}\n`));
      }
    });

    child.on('error', (error) => {
      if (isBenignPipeError(error)) return;
      childError = error;
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortHandler);
      if (childError) {
        reject(childError);
        return;
      }
      resolve({
        command,
        exit_code: code,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        duration_ms: Date.now() - startedAt,
        timed_out: timedOut,
        truncated: stdout.truncated || stderr.truncated,
      });
    });
  });
}

class BoundedBuffer {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    if (this.bytes >= this.maxBytes) {
      this.truncated = true;
      return;
    }
    const remaining = this.maxBytes - this.bytes;
    if (chunk.byteLength <= remaining) {
      this.chunks.push(chunk);
      this.bytes += chunk.byteLength;
      return;
    }
    this.chunks.push(chunk.subarray(0, remaining));
    this.bytes = this.maxBytes;
    this.truncated = true;
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString('utf8').replace(/\r\n/g, '\n');
  }
}

function mapAiSdkResponse(
  result: AiGenerateTextResult,
  context: {
    readonly model: string;
    readonly baseURL: string;
    readonly maxSteps: number;
    readonly toolAllowlist: readonly AiSdkToolName[];
    readonly observedToolCalls: readonly ToolCall[];
    readonly durationMs: number;
    readonly startTime: string;
    readonly endTime: string;
  },
): ProviderResponse {
  const resultToolCalls = toolCallsFromResult(result);
  const toolCalls =
    context.observedToolCalls.length > 0 ? context.observedToolCalls : resultToolCalls;
  const output: Message[] = [
    {
      role: 'assistant',
      content: typeof result.text === 'string' ? result.text : '',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      startTime: context.startTime,
      endTime: context.endTime,
      durationMs: context.durationMs,
      metadata: {
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
      },
    },
  ];

  const tokenUsage = toProviderTokenUsage(result.totalUsage ?? result.usage);
  const stepCount =
    Array.isArray(result.steps) && result.steps.length > 0 ? result.steps.length : 1;

  return {
    raw: {
      provider: 'ai-sdk-agent',
      model: context.model,
      baseURL: context.baseURL,
      maxSteps: context.maxSteps,
      tools: context.toolAllowlist,
      finishReason: result.finishReason,
      rawFinishReason: result.rawFinishReason,
      warnings: result.warnings,
      request: result.request,
      response: result.response,
      providerMetadata: result.providerMetadata,
      steps: result.steps,
    },
    output,
    ...(tokenUsage ? { tokenUsage } : {}),
    usage: toJsonObject(result.totalUsage ?? result.usage),
    durationMs: context.durationMs,
    startTime: context.startTime,
    endTime: context.endTime,
    steps: {
      count: stepCount,
      toolCallCount: toolCalls.length,
    },
  };
}

function toolCallsFromResult(result: AiGenerateTextResult): ToolCall[] {
  const outputById = new Map<string, AiToolResult>();
  for (const toolResult of result.toolResults ?? []) {
    if (toolResult.toolCallId) {
      outputById.set(toolResult.toolCallId, toolResult);
    }
  }
  for (const step of result.steps ?? []) {
    for (const toolResult of step.toolResults ?? []) {
      if (toolResult.toolCallId) {
        outputById.set(toolResult.toolCallId, toolResult);
      }
    }
  }

  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  const append = (toolCall: AiToolCall) => {
    const id = toolCall.toolCallId;
    const name = toolCall.toolName;
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    const resultForCall = outputById.get(id);
    calls.push(
      normalizeToolCall('ai-sdk-agent', {
        tool: name,
        input: toolCall.input ?? resultForCall?.input,
        output: resultForCall?.output,
        id,
      }),
    );
  };

  for (const step of result.steps ?? []) {
    for (const toolCall of step.toolCalls ?? []) append(toolCall);
  }
  for (const toolCall of result.toolCalls ?? []) append(toolCall);
  return calls;
}

function toProviderTokenUsage(usage: AiUsage | undefined): ProviderTokenUsage | undefined {
  if (!usage) return undefined;
  const input = finiteOrZero(usage.inputTokens);
  const output = finiteOrZero(usage.outputTokens);
  const cached = finiteOrUndefined(
    usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens,
  );
  const reasoning = finiteOrUndefined(
    usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens,
  );
  return {
    input,
    output,
    ...(cached !== undefined ? { cached } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    return undefined;
  }
}

export const _internal = {
  createCodingTools,
  findManagedSdkInstallRoot,
  formatDependencyLoadError,
  isBenignPipeError,
  parseToolAllowlist,
  resolveWorkspacePath,
  runBashCommand,
  setLoaderForTesting(loader: (() => Promise<AiSdkModules>) | undefined): void {
    loaderOverride = loader;
    sdkModules = null;
    loadingPromise = null;
  },
};
