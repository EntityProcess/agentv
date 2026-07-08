import { exec as execCallback, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { trackChild } from '../../runtime/child-tracker.js';
import { recordCodexLogEntry } from './codex-log-tracker.js';
import { resolveDefaultProviderLogDir } from './log-directory.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import { deriveSkillCallsFromMessages, skillCallMetadata } from './skill-calls.js';
import type { CodexResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  TargetExecutionEnvelope,
  TargetExecutionErrorKind,
  TargetExecutionLogCapture,
} from './types.js';
import { extractLastAssistantContent } from './types.js';

const execAsync = promisify(execCallback);
const WORKSPACE_PREFIX = 'agentv-codex-';
const PROMPT_FILENAME = 'prompt.md';
const JSONL_TYPE_ITEM_COMPLETED = 'item.completed';

interface CodexRunOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly prompt: string;
  readonly appServerRequest?: CodexAppServerRunRequest;
  readonly timeoutMs?: number;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly onStdoutChunk?: (chunk: string) => void;
  readonly onStderrChunk?: (chunk: string) => void;
}

interface CodexRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly timedOut?: boolean;
  readonly cancelled?: boolean;
}

type CodexRunner = (options: CodexRunOptions) => Promise<CodexRunResult>;

interface CodexAppServerRunRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly modelProvider?: string;
  readonly modelReasoningEffort?: string;
  readonly sandboxMode?: string;
  readonly approvalPolicy?: string;
  readonly systemPrompt?: string;
}

export class CodexCliProvider implements Provider {
  readonly id: string;
  readonly kind: 'codex-cli' | 'codex-app-server';
  readonly targetName: string;
  private readonly config: CodexResolvedConfig;
  private readonly runCodex: CodexRunner;
  private environmentCheck?: Promise<void>;
  private resolvedExecutable?: string;

  constructor(
    targetName: string,
    config: CodexResolvedConfig,
    runner: CodexRunner = defaultCodexRunner,
    kind: 'codex-cli' | 'codex-app-server' = 'codex-cli',
  ) {
    this.kind = kind;
    this.id = `${kind}:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runCodex = runner;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      return this.buildUnsupportedRuntimeOrEarlyCancel('cancelled', 'Codex request was cancelled');
    }

    if (this.config.runtime.mode === 'sandbox') {
      return this.buildUnsupportedRuntimeOrEarlyCancel(
        'sandbox_infra_failure',
        'runtime.mode: sandbox for Codex targets is not available in this AgentV build. Use runtime: host/profile or the sandbox runtime provider once configured.',
      );
    }

    await this.ensureEnvironmentReady();

    const inputFiles = normalizeInputFiles(request.inputFiles) ?? [];

    const workspaceRoot = await this.createWorkspace();
    const logger = await this.createStreamLogger(request).catch(() => undefined);
    try {
      const basePrompt = buildPromptDocument(request, inputFiles);
      const systemPrompt = this.config.systemPrompt;
      const promptContent = systemPrompt ? `${systemPrompt}\n\n${basePrompt}` : basePrompt;
      const promptFile = path.join(workspaceRoot, PROMPT_FILENAME);
      await writeFile(promptFile, promptContent, 'utf8');

      const args = this.buildCodexArgs();
      const cwd = this.resolveCwd(workspaceRoot, request.cwd);
      const env = await this.buildProcessEnv(workspaceRoot);
      const startedAt = Date.now();
      let result: CodexRunResult;
      try {
        result = await this.executeCodex(
          args,
          cwd,
          this.buildStdinPayload(promptContent, request),
          env,
          request.signal,
          logger,
          this.buildAppServerRequest(promptContent),
        );
      } catch (error) {
        const message = formatError(error);
        return this.buildErrorResponse({
          errorKind: 'spawn_failure',
          message,
          args,
          cwd,
          startedAt,
          endedAt: Date.now(),
          stdout: '',
          stderr: message,
          inputFiles,
          promptFile,
          workspaceRoot,
          logFile: logger?.filePath,
        });
      }

      if (result.timedOut) {
        return this.buildErrorResponse({
          errorKind: 'timeout',
          message: `Codex ${this.providerLabel()} timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
          args,
          cwd,
          startedAt,
          endedAt: Date.now(),
          result,
          inputFiles,
          promptFile,
          workspaceRoot,
          logFile: logger?.filePath,
        });
      }

      if (result.cancelled || request.signal?.aborted) {
        return this.buildErrorResponse({
          errorKind: 'cancelled',
          message: `Codex ${this.providerLabel()} request was cancelled`,
          args,
          cwd,
          startedAt,
          endedAt: Date.now(),
          result,
          inputFiles,
          promptFile,
          workspaceRoot,
          logFile: logger?.filePath,
        });
      }

      if (result.exitCode !== 0) {
        const detail = pickDetail(result.stderr, result.stdout);
        const prefix = `Codex ${this.providerLabel()} exited with code ${result.exitCode}`;
        return this.buildErrorResponse({
          errorKind: this.classifyNonzeroExit(result),
          message: detail ? `${prefix}: ${detail}` : prefix,
          args,
          cwd,
          startedAt,
          endedAt: Date.now(),
          result,
          inputFiles,
          promptFile,
          workspaceRoot,
          logFile: logger?.filePath,
        });
      }

      let parsed: unknown;
      let messages: readonly Message[];
      try {
        parsed = parseCodexJson(result.stdout);
        messages = extractAssistantMessages(parsed);
      } catch (error) {
        const message = formatError(error);
        return this.buildErrorResponse({
          errorKind: 'malformed_output',
          message,
          args,
          cwd,
          startedAt,
          endedAt: Date.now(),
          result,
          inputFiles,
          promptFile,
          workspaceRoot,
          logFile: logger?.filePath,
        });
      }
      const assistantText = extractLastAssistantContent(messages);
      const durationMs = Date.now() - startedAt;

      return {
        raw: {
          response: parsed,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          args,
          executable: this.resolvedExecutable ?? this.config.command?.[0],
          promptFile,
          workspace: workspaceRoot,
          inputFiles,
          logFile: logger?.filePath,
        },
        metadata: skillCallMetadata(deriveSkillCallsFromMessages(messages)),
        output: messages,
        durationMs,
        targetExecution: {
          ...this.buildEnvelopeBase({
            args,
            cwd,
            startedAt,
            endedAt: Date.now(),
            result,
          }),
          status: 'success',
          transcript: {
            messages,
            finalOutput: assistantText,
          },
          details: {
            promptFile,
            workspace: workspaceRoot,
            inputFiles,
            logFile: logger?.filePath,
          },
        },
      };
    } finally {
      await logger?.close();
      await this.cleanupWorkspace(workspaceRoot);
    }
  }

  private async ensureEnvironmentReady(): Promise<void> {
    if (!this.environmentCheck) {
      this.environmentCheck = this.validateEnvironment();
    }
    await this.environmentCheck;
  }

  private async validateEnvironment(): Promise<void> {
    this.resolvedExecutable = await locateExecutable(this.commandExecutable());
  }

  private resolveCwd(workspaceRoot: string, cwdOverride?: string): string {
    // Request cwd override takes precedence (e.g., from eval-level workspace.template)
    if (cwdOverride) {
      return path.resolve(cwdOverride);
    }
    if (!this.config.cwd) {
      return workspaceRoot;
    }
    return path.resolve(this.config.cwd);
  }

  private buildCodexArgs(): string[] {
    const [, ...configuredArgs] = this.config.command ?? [];
    if (this.kind === 'codex-app-server') {
      return configuredArgs;
    }

    const args = [...configuredArgs];
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.modelReasoningEffort) {
      args.push('--config', `model_reasoning_effort=${this.config.modelReasoningEffort}`);
    }
    if (this.config.modelVerbosity) {
      args.push('--config', `model_verbosity=${this.config.modelVerbosity}`);
    }
    if (this.config.sandboxMode) {
      args.push('--sandbox', this.config.sandboxMode);
    }
    if (this.config.approvalPolicy) {
      args.push('--ask-for-approval', this.config.approvalPolicy);
    }
    args.push('exec', '--json', '--color', 'never', '--skip-git-repo-check');
    args.push('-');
    return args;
  }

  private async executeCodex(
    args: readonly string[],
    cwd: string,
    stdinPayload: string,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal | undefined,
    logger: CodexStreamLogger | undefined,
    appServerRequest?: CodexAppServerRunRequest,
  ): Promise<CodexRunResult> {
    return await this.runCodex({
      executable: this.resolvedExecutable ?? this.commandExecutable(),
      args,
      cwd,
      prompt: stdinPayload,
      appServerRequest,
      timeoutMs: this.config.timeoutMs,
      env,
      signal,
      onStdoutChunk: logger ? (chunk) => logger.handleStdoutChunk(chunk) : undefined,
      onStderrChunk: logger ? (chunk) => logger.handleStderrChunk(chunk) : undefined,
    });
  }

  private buildStdinPayload(promptContent: string, request: ProviderRequest): string {
    if (this.kind !== 'codex-app-server') {
      return promptContent;
    }
    return `${JSON.stringify({
      type: 'agentv.invoke',
      question: request.question,
      prompt: promptContent,
      eval_case_id: request.evalCaseId,
      attempt: request.attempt,
    })}\n`;
  }

  private buildAppServerRequest(promptContent: string): CodexAppServerRunRequest | undefined {
    if (this.kind !== 'codex-app-server') {
      return undefined;
    }
    return {
      prompt: promptContent,
      model: this.config.model,
      modelProvider: inferCodexModelProvider(this.config.command ?? []),
      modelReasoningEffort: this.config.modelReasoningEffort,
      sandboxMode: this.config.sandboxMode,
      approvalPolicy: this.config.approvalPolicy,
      systemPrompt: this.config.systemPrompt,
    };
  }

  private async createWorkspace(): Promise<string> {
    return await mkdtemp(path.join(tmpdir(), WORKSPACE_PREFIX));
  }

  private commandExecutable(): string {
    const executable = this.config.command?.[0];
    if (!executable) {
      throw new Error(`Codex ${this.providerLabel()} requires config.command`);
    }
    return executable;
  }

  private providerLabel(): string {
    return this.kind === 'codex-app-server' ? 'app-server' : 'CLI';
  }

  private classifyNonzeroExit(result: CodexRunResult): TargetExecutionErrorKind {
    if (this.kind === 'codex-app-server' && isCodexAppServerProtocolFailure(result.stderr)) {
      return 'malformed_output';
    }
    return result.signal ? 'signal_crash' : 'nonzero_exit';
  }

  private async buildProcessEnv(workspaceRoot: string): Promise<NodeJS.ProcessEnv> {
    if (this.config.runtime.mode === 'host') {
      return process.env;
    }

    const runtime = this.config.runtime;
    const env: NodeJS.ProcessEnv = {};
    const allowlist = runtime.envAllowlist ?? defaultProfileEnvAllowlist();
    for (const key of allowlist) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }

    const profileHome = path.resolve(runtime.home ?? path.join(workspaceRoot, 'profile-home'));
    const codexHome = path.resolve(runtime.codexHome ?? path.join(profileHome, '.codex'));
    const tmpRoot = path.resolve(runtime.tmpDir ?? path.join(profileHome, '.tmp'));
    await mkdir(codexHome, { recursive: true });
    await mkdir(tmpRoot, { recursive: true });

    env.HOME = profileHome;
    env.USERPROFILE = profileHome;
    env.CODEX_HOME = codexHome;
    env.TMPDIR = tmpRoot;
    env.TMP = tmpRoot;
    env.TEMP = tmpRoot;
    for (const [key, value] of Object.entries(runtime.env ?? {})) {
      env[key] = value;
    }
    return env;
  }

  private buildUnsupportedRuntimeOrEarlyCancel(
    errorKind: TargetExecutionErrorKind,
    message: string,
  ): ProviderResponse {
    const now = Date.now();
    return {
      output: [{ role: 'assistant', content: `Error: ${message}` }],
      durationMs: 0,
      targetExecution: {
        ...this.buildEnvelopeBase({
          args: this.config.command?.slice(1) ?? [],
          cwd: this.config.cwd,
          startedAt: now,
          endedAt: now,
          result: { stdout: '', stderr: '', exitCode: null },
        }),
        status: 'error',
        errorKind,
        message,
        transcript: {
          messages: [{ role: 'assistant', content: `Error: ${message}` }],
          finalOutput: `Error: ${message}`,
        },
      },
      raw: { error: message },
    };
  }

  private buildErrorResponse(params: {
    readonly errorKind: TargetExecutionErrorKind;
    readonly message: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly startedAt: number;
    readonly endedAt: number;
    readonly result?: CodexRunResult;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly inputFiles: readonly string[];
    readonly promptFile: string;
    readonly workspaceRoot: string;
    readonly logFile?: string;
  }): ProviderResponse {
    const output = [{ role: 'assistant' as const, content: `Error: ${params.message}` }];
    return {
      output,
      durationMs: params.endedAt - params.startedAt,
      targetExecution: {
        ...this.buildEnvelopeBase({
          args: params.args,
          cwd: params.cwd,
          startedAt: params.startedAt,
          endedAt: params.endedAt,
          result: params.result ?? {
            stdout: params.stdout ?? '',
            stderr: params.stderr ?? '',
            exitCode: null,
          },
        }),
        status: 'error',
        errorKind: params.errorKind,
        message: params.message,
        transcript: {
          messages: output,
          finalOutput: `Error: ${params.message}`,
        },
        details: {
          promptFile: params.promptFile,
          workspace: params.workspaceRoot,
          inputFiles: params.inputFiles,
          logFile: params.logFile,
        },
      },
      raw: {
        stderr: params.result?.stderr ?? params.stderr ?? '',
        stdout: params.result?.stdout ?? params.stdout ?? '',
        exitCode: params.result?.exitCode ?? null,
        signal: params.result?.signal ?? null,
        cwd: params.cwd,
        args: params.args,
        executable: this.resolvedExecutable ?? this.config.command?.[0],
        error: params.message,
        logFile: params.logFile,
      },
    };
  }

  private buildEnvelopeBase(params: {
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly startedAt: number;
    readonly endedAt: number;
    readonly result?: CodexRunResult;
  }): Omit<TargetExecutionEnvelope, 'status'> {
    const executable = this.resolvedExecutable ?? this.config.command?.[0] ?? 'codex';
    const argv = [executable, ...params.args];
    const stdout = params.result?.stdout ?? '';
    const stderr = params.result?.stderr ?? '';
    return {
      schemaVersion: 'agentv.target_execution.v1',
      targetId: this.targetName,
      providerId: this.id,
      providerKind: this.kind,
      runtimeMode: this.config.runtime.mode,
      command: {
        argv,
        commandLine: argv.map(shellQuote).join(' '),
        cwd: params.cwd,
      },
      timeoutMs: this.config.timeoutMs,
      startedAt: new Date(params.startedAt).toISOString(),
      endedAt: new Date(params.endedAt).toISOString(),
      durationMs: params.endedAt - params.startedAt,
      exitCode: params.result?.exitCode,
      signal: params.result?.signal ?? null,
      logs: {
        stdout: captureLog(stdout),
        stderr: captureLog(stderr),
      },
    };
  }

  private async cleanupWorkspace(workspaceRoot: string): Promise<void> {
    try {
      await rm(workspaceRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  private resolveLogDirectory(request: ProviderRequest): string | undefined {
    const disabled = isCodexLogStreamingDisabled();
    if (disabled || this.config.streamLog === false) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return resolveDefaultProviderLogDir('codex', request);
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<CodexStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory(request);
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Codex stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await CodexStreamLogger.create({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
        format: this.config.streamLog === 'raw' ? 'json' : 'summary',
      });
      recordCodexLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Codex stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

export class CodexAppServerProvider extends CodexCliProvider {
  constructor(
    targetName: string,
    config: CodexResolvedConfig,
    runner: CodexRunner = defaultCodexRunner,
  ) {
    super(targetName, config, runner, 'codex-app-server');
  }
}

class CodexStreamLogger {
  readonly filePath: string;
  private readonly stream: WriteStream;
  private readonly startedAt = Date.now();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private readonly format: 'summary' | 'json';

  private constructor(filePath: string, format: 'summary' | 'json') {
    this.filePath = filePath;
    this.format = format;
    this.stream = createWriteStream(filePath, { flags: 'a' });
  }

  static async create(options: {
    readonly filePath: string;
    readonly targetName: string;
    readonly evalCaseId?: string;
    readonly attempt?: number;
    readonly format: 'summary' | 'json';
  }): Promise<CodexStreamLogger> {
    const logger = new CodexStreamLogger(options.filePath, options.format);
    const header = [
      '# Codex CLI stream log',
      `# target: ${options.targetName}`,
      options.evalCaseId ? `# eval: ${options.evalCaseId}` : undefined,
      options.attempt !== undefined ? `# attempt: ${options.attempt + 1}` : undefined,
      `# started: ${new Date().toISOString()}`,
      '',
    ].filter((line): line is string => Boolean(line));
    logger.writeLines(header);
    return logger;
  }

  handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    this.flushBuffer('stdout');
  }

  handleStderrChunk(chunk: string): void {
    this.stderrBuffer += chunk;
    this.flushBuffer('stderr');
  }

  async close(): Promise<void> {
    this.flushBuffer('stdout');
    this.flushBuffer('stderr');
    this.flushRemainder();
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(() => resolve());
    });
  }

  private writeLines(lines: readonly string[]): void {
    for (const line of lines) {
      this.stream.write(`${line}\n`);
    }
  }

  private flushBuffer(source: 'stdout' | 'stderr'): void {
    const buffer = source === 'stdout' ? this.stdoutBuffer : this.stderrBuffer;
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    if (source === 'stdout') {
      this.stdoutBuffer = remainder;
    } else {
      this.stderrBuffer = remainder;
    }
    for (const line of lines) {
      const formatted = this.formatLine(line, source);
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write('\n');
      }
    }
  }

  private formatLine(rawLine: string, source: 'stdout' | 'stderr'): string | undefined {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const message =
      this.format === 'json' ? formatCodexJsonLog(trimmed) : formatCodexLogMessage(trimmed, source);
    return `[+${formatElapsed(this.startedAt)}] [${source}] ${message}`;
  }

  private flushRemainder(): void {
    const stdoutRemainder = this.stdoutBuffer.trim();
    if (stdoutRemainder.length > 0) {
      const formatted = this.formatLine(stdoutRemainder, 'stdout');
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write('\n');
      }
    }
    const stderrRemainder = this.stderrBuffer.trim();
    if (stderrRemainder.length > 0) {
      const formatted = this.formatLine(stderrRemainder, 'stderr');
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write('\n');
      }
    }
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }
}

function isCodexLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_CODEX_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'codex');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'codex';
}

function formatElapsed(startedAt: number): string {
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatCodexLogMessage(rawLine: string, source: 'stdout' | 'stderr'): string {
  const parsed = tryParseJsonValue(rawLine);
  if (parsed) {
    const summary = summarizeCodexEvent(parsed);
    if (summary) {
      return summary;
    }
  }
  if (source === 'stderr') {
    return `stderr: ${rawLine}`;
  }
  return rawLine;
}

function formatCodexJsonLog(rawLine: string): string {
  const parsed = tryParseJsonValue(rawLine);
  if (!parsed) {
    return rawLine;
  }
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return rawLine;
  }
}

function summarizeCodexEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  const record = event as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : undefined;
  let message =
    extractFromEvent(event) ??
    extractFromItem(record.item) ??
    flattenContent(record.output ?? record.content);
  if (!message && type === JSONL_TYPE_ITEM_COMPLETED) {
    const item = record.item;
    if (item && typeof item === 'object') {
      const candidate = flattenContent(
        (item as Record<string, unknown>).text ??
          (item as Record<string, unknown>).content ??
          (item as Record<string, unknown>).output,
      );
      if (candidate) {
        message = candidate;
      }
    }
  }
  if (!message) {
    const itemType =
      typeof (record.item as Record<string, unknown> | undefined)?.type === 'string'
        ? (record.item as Record<string, unknown>).type
        : undefined;
    if (type && itemType) {
      return `${type}:${itemType}`;
    }
    if (type) {
      return type;
    }
  }
  if (type && message) {
    return `${type}: ${message}`;
  }
  if (message) {
    return message;
  }
  return type;
}

function tryParseJsonValue(rawLine: string): unknown | undefined {
  try {
    return JSON.parse(rawLine);
  } catch {
    return undefined;
  }
}

async function locateExecutable(candidate: string): Promise<string> {
  const includesPathSeparator = candidate.includes('/') || candidate.includes('\\');
  if (includesPathSeparator) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
    const executablePath = await ensureWindowsExecutableVariant(resolved);
    await access(executablePath, constants.F_OK);
    return executablePath;
  }

  const locator = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execAsync(`${locator} ${candidate}`);
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const preferred = selectExecutableCandidate(lines);
    if (preferred) {
      const executablePath = await ensureWindowsExecutableVariant(preferred);
      await access(executablePath, constants.F_OK);
      return executablePath;
    }
  } catch {
    // ignore and fall back to error below
  }

  throw new Error(`Codex executable '${candidate}' was not found on PATH`);
}

function selectExecutableCandidate(candidates: readonly string[]): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (process.platform !== 'win32') {
    return candidates[0];
  }
  const extensions = getWindowsExecutableExtensions();
  for (const ext of extensions) {
    const match = candidates.find((candidate) => candidate.toLowerCase().endsWith(ext));
    if (match) {
      return match;
    }
  }
  return candidates[0];
}

async function ensureWindowsExecutableVariant(candidate: string): Promise<string> {
  if (process.platform !== 'win32') {
    return candidate;
  }
  if (hasExecutableExtension(candidate)) {
    return candidate;
  }

  const extensions = getWindowsExecutableExtensions();
  for (const ext of extensions) {
    const withExtension = `${candidate}${ext}`;
    try {
      await access(withExtension, constants.F_OK);
      return withExtension;
    } catch {
      // keep searching
    }
  }
  return candidate;
}

function hasExecutableExtension(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  return getWindowsExecutableExtensions().some((ext) => lower.endsWith(ext));
}

const DEFAULT_WINDOWS_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd', '.ps1'] as const;

function getWindowsExecutableExtensions(): readonly string[] {
  if (process.platform !== 'win32') {
    return [];
  }
  const fromEnv = process.env.PATHEXT?.split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0);
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_WINDOWS_EXTENSIONS;
}

function parseCodexJson(output: string): unknown {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new Error('Codex CLI produced no output in --json mode');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const lineObjects = parseJsonLines(trimmed);
    if (lineObjects) {
      return lineObjects;
    }
    const lastBrace = trimmed.lastIndexOf('{');
    if (lastBrace >= 0) {
      const candidate = trimmed.slice(lastBrace);
      try {
        return JSON.parse(candidate);
      } catch {
        // fallthrough
      }
    }
    const preview = trimmed.slice(0, 200);
    throw new Error(`Codex CLI emitted invalid JSON: ${preview}${trimmed.length > 200 ? '…' : ''}`);
  }
}

function extractAssistantText(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    const text = extractFromEventStream(parsed);
    if (text) {
      return text;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Codex CLI JSON response did not include an assistant message');
  }

  const record = parsed as Record<string, unknown>;
  const eventText = extractFromEvent(record);
  if (eventText) {
    return eventText;
  }

  const messages = Array.isArray(record.messages) ? record.messages : undefined;
  if (messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index];
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const role = (entry as Record<string, unknown>).role;
      if (role !== 'assistant') {
        continue;
      }
      const content = (entry as Record<string, unknown>).content;
      const flattened = flattenContent(content);
      if (flattened) {
        return flattened;
      }
    }
  }

  const response = record.response;
  if (response && typeof response === 'object') {
    const content = (response as Record<string, unknown>).content;
    const flattened = flattenContent(content);
    if (flattened) {
      return flattened;
    }
  }

  const output = record.output;
  const flattenedOutput = flattenContent(output);
  if (flattenedOutput) {
    return flattenedOutput;
  }

  throw new Error('Codex CLI JSON response did not include an assistant message');
}

function extractAssistantMessages(parsed: unknown): readonly Message[] {
  const text = extractAssistantText(parsed);
  return [{ role: 'assistant', content: text }];
}

function extractFromEventStream(events: readonly unknown[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    const text = extractFromEvent(candidate);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function extractFromEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  const record = event as Record<string, unknown>;
  const method = typeof record.method === 'string' ? record.method : undefined;
  if (method === 'item/completed') {
    return extractFromAppServerItem((record.params as Record<string, unknown> | undefined)?.item);
  }
  if (method === 'turn/completed') {
    return extractFromAppServerTurn(record.params);
  }
  const type = typeof record.type === 'string' ? record.type : undefined;
  if (type === JSONL_TYPE_ITEM_COMPLETED) {
    const item = record.item;
    const text = extractFromItem(item);
    if (text) {
      return text;
    }
  }
  const output = record.output ?? record.content;
  const flattened = flattenContent(output);
  if (flattened) {
    return flattened;
  }
  return undefined;
}

function extractFromAppServerTurn(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') {
    return undefined;
  }
  const turn = (params as Record<string, unknown>).turn;
  if (!turn || typeof turn !== 'object') {
    return undefined;
  }
  const items = (turn as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    return undefined;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = extractFromAppServerItem(items[index]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function extractFromAppServerItem(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  if (record.type !== 'agentMessage') {
    return undefined;
  }
  const text = record.text;
  return typeof text === 'string' && text.length > 0 ? text : undefined;
}

function extractFromItem(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  const itemType = typeof record.type === 'string' ? record.type : undefined;
  if (itemType === 'agent_message' || itemType === 'response' || itemType === 'output') {
    const text = flattenContent(record.text ?? record.content ?? record.output);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function flattenContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((segment) => {
        if (typeof segment === 'string') {
          return segment;
        }
        if (segment && typeof segment === 'object' && 'text' in segment) {
          const text = (segment as Record<string, unknown>).text;
          return typeof text === 'string' ? text : undefined;
        }
        return undefined;
      })
      .filter((part): part is string => typeof part === 'string' && part.length > 0);
    return parts.length > 0 ? parts.join(' \n') : undefined;
  }
  if (value && typeof value === 'object' && 'text' in value) {
    const text = (value as Record<string, unknown>).text;
    return typeof text === 'string' ? text : undefined;
  }
  return undefined;
}

function parseJsonLines(output: string): unknown[] | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) {
    return undefined;
  }
  const parsed: unknown[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      return undefined;
    }
  }
  return parsed;
}

function pickDetail(stderr: string, stdout: string): string | undefined {
  const errorText = stderr.trim();
  if (errorText.length > 0) {
    return errorText;
  }
  const stdoutText = stdout.trim();
  return stdoutText.length > 0 ? stdoutText : undefined;
}

function formatTimeoutSuffix(timeoutMs: number | undefined): string {
  if (!timeoutMs || timeoutMs <= 0) {
    return '';
  }
  const seconds = Math.ceil(timeoutMs / 1000);
  return ` after ${seconds}s`;
}

const INLINE_LOG_LIMIT_BYTES = 128 * 1024;

function captureLog(text: string): TargetExecutionLogCapture {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= INLINE_LOG_LIMIT_BYTES) {
    return {
      text,
      truncated: false,
      bytes,
      storedBytes: bytes,
    };
  }
  let stored = text;
  while (Buffer.byteLength(stored, 'utf8') > INLINE_LOG_LIMIT_BYTES) {
    stored = stored.slice(0, Math.max(0, stored.length - 1024));
  }
  return {
    text: stored,
    truncated: true,
    bytes,
    storedBytes: Buffer.byteLength(stored, 'utf8'),
  };
}

function defaultProfileEnvAllowlist(): readonly string[] {
  return process.platform === 'win32'
    ? ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'COMSPEC', 'LANG', 'LC_ALL', 'NO_COLOR']
    : ['PATH', 'LANG', 'LC_ALL', 'TERM', 'NO_COLOR', 'SHELL'];
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCodexAppServerProtocolFailure(stderr: string): boolean {
  return (
    stderr.includes('Codex app-server JSON-RPC error') ||
    stderr.includes('Codex app-server emitted invalid JSON-RPC line') ||
    stderr.includes('Codex app-server thread/start response did not include a thread id') ||
    stderr.includes('Codex app-server exited before turn/completed')
  );
}

async function defaultCodexRunner(options: CodexRunOptions): Promise<CodexRunResult> {
  if (options.appServerRequest) {
    return await defaultCodexAppServerRunner(options);
  }

  return await new Promise<CodexRunResult>((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      shell: shouldShellExecute(options.executable),
    });
    trackChild(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;

    const onAbort = (): void => {
      cancelled = true;
      terminateChild(child, 'SIGTERM');
      setTimeout(() => terminateChild(child, 'SIGKILL'), 2_000).unref?.();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminateChild(child, 'SIGTERM');
        setTimeout(() => terminateChild(child, 'SIGKILL'), 2_000).unref?.();
      }, options.timeoutMs);
      timeoutHandle.unref?.();
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    child.stdin.end(options.prompt);

    const cleanup = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code, signal) => {
      cleanup();
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : null,
        signal,
        timedOut,
        cancelled,
      });
    });
  });
}

async function defaultCodexAppServerRunner(options: CodexRunOptions): Promise<CodexRunResult> {
  return await new Promise<CodexRunResult>((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      shell: shouldShellExecute(options.executable),
    });
    trackChild(child);

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let timedOut = false;
    let cancelled = false;
    let protocolError: string | undefined;
    let turnCompleted = false;
    let requestId = 1;
    const initializeId = requestId;
    let threadStartId: number | undefined;
    let turnStartId: number | undefined;

    const appServerRequest = options.appServerRequest;
    if (!appServerRequest) {
      reject(new Error('Codex app-server request metadata was not provided'));
      return;
    }

    const send = (method: string, params: Record<string, unknown>): number => {
      const id = requestId;
      requestId += 1;
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      return id;
    };

    const failProtocol = (message: string): void => {
      if (!protocolError) {
        protocolError = message;
      }
      child.stdin.end();
      terminateChild(child, 'SIGTERM');
    };

    const handleMessage = (message: unknown): void => {
      if (!message || typeof message !== 'object') {
        return;
      }
      const record = message as Record<string, unknown>;
      if ('error' in record) {
        failProtocol(`Codex app-server JSON-RPC error: ${formatJsonRpcError(record.error)}`);
        return;
      }

      if (record.id === initializeId && record.result) {
        threadStartId = send(
          'thread/start',
          buildAppServerThreadStartParams(options, appServerRequest),
        );
        return;
      }

      if (record.id === threadStartId && record.result && typeof record.result === 'object') {
        const threadId = extractAppServerThreadId(record.result);
        if (!threadId) {
          failProtocol('Codex app-server thread/start response did not include a thread id');
          return;
        }
        turnStartId = send(
          'turn/start',
          buildAppServerTurnStartParams(options, appServerRequest, threadId),
        );
        return;
      }

      if (record.id === turnStartId && record.result) {
        return;
      }

      if (record.method === 'turn/completed') {
        turnCompleted = true;
        const turn = (record.params as Record<string, unknown> | undefined)?.turn;
        const status = (turn as Record<string, unknown> | undefined)?.status;
        if (status === 'failed') {
          const error = (turn as Record<string, unknown>).error;
          protocolError = `Codex app-server turn failed: ${formatTurnError(error)}`;
        }
        child.stdin.end();
      }
    };

    const onAbort = (): void => {
      cancelled = true;
      terminateChild(child, 'SIGTERM');
      setTimeout(() => terminateChild(child, 'SIGKILL'), 2_000).unref?.();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminateChild(child, 'SIGTERM');
        setTimeout(() => terminateChild(child, 'SIGKILL'), 2_000).unref?.();
      }, options.timeoutMs);
      timeoutHandle.unref?.();
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length === 0) {
          continue;
        }
        try {
          handleMessage(JSON.parse(line));
        } catch (error) {
          failProtocol(`Codex app-server emitted invalid JSON-RPC line: ${formatError(error)}`);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    const cleanup = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code, signal) => {
      cleanup();
      const resultExitCode =
        protocolError && typeof code === 'number' && code === 0
          ? 1
          : typeof code === 'number'
            ? code
            : null;
      const appServerStderr =
        protocolError && stderr.trim().length > 0
          ? `${stderr}\n${protocolError}`
          : (protocolError ?? stderr);
      resolve({
        stdout,
        stderr:
          !protocolError && !turnCompleted && !timedOut && !cancelled
            ? appendLine(appServerStderr, 'Codex app-server exited before turn/completed')
            : appServerStderr,
        exitCode:
          !protocolError && !turnCompleted && !timedOut && !cancelled && resultExitCode === 0
            ? 1
            : resultExitCode,
        signal,
        timedOut,
        cancelled,
      });
    });

    send('initialize', {
      clientInfo: { name: 'agentv', version: '0.0.0' },
      capabilities: null,
    });
  });
}

function buildAppServerThreadStartParams(
  options: CodexRunOptions,
  request: CodexAppServerRunRequest,
): Record<string, unknown> {
  return removeUndefined({
    model: request.model,
    modelProvider: request.modelProvider,
    cwd: options.cwd,
    approvalPolicy: request.approvalPolicy,
    sandbox: request.sandboxMode,
    baseInstructions: request.systemPrompt,
    ephemeral: true,
  });
}

function buildAppServerTurnStartParams(
  options: CodexRunOptions,
  request: CodexAppServerRunRequest,
  threadId: string,
): Record<string, unknown> {
  return removeUndefined({
    threadId,
    input: [{ type: 'text', text: request.prompt, text_elements: [] }],
    cwd: options.cwd,
    approvalPolicy: request.approvalPolicy,
    model: request.model,
    effort: request.modelReasoningEffort,
  });
}

function extractAppServerThreadId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const thread = (result as Record<string, unknown>).thread;
  if (!thread || typeof thread !== 'object') {
    return undefined;
  }
  const id = (thread as Record<string, unknown>).id;
  return typeof id === 'string' ? id : undefined;
}

function inferCodexModelProvider(command: readonly string[]): string | undefined {
  for (let index = 0; index < command.length - 1; index += 1) {
    const flag = command[index];
    if (flag !== '-c' && flag !== '--config') {
      continue;
    }
    const value = command[index + 1];
    const match = /^model_provider=(?:"([^"]+)"|'([^']+)'|(.+))$/.exec(value);
    const provider = match?.[1] ?? match?.[2] ?? match?.[3];
    if (provider && provider.trim().length > 0) {
      return provider.trim();
    }
  }
  return undefined;
}

function removeUndefined(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function formatJsonRpcError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error);
  }
  const record = error as Record<string, unknown>;
  const code = typeof record.code === 'number' ? `${record.code}: ` : '';
  const message = typeof record.message === 'string' ? record.message : JSON.stringify(error);
  return `${code}${message}`;
}

function formatTurnError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error);
  }
  const record = error as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : JSON.stringify(error);
  const details =
    typeof record.additionalDetails === 'string' ? ` (${record.additionalDetails})` : '';
  return `${message}${details}`;
}

function appendLine(base: string, line: string): string {
  return base.trim().length > 0 ? `${base}\n${line}` : line;
}

function terminateChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function shouldShellExecute(executable: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  const lower = executable.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1');
}
