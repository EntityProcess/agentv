import { exec as execCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { recordCopilotCliLogEntry } from './copilot-cli-log-tracker.js';
import { collectGuidelineFiles, normalizeInputFiles } from './preread.js';
import type { CopilotResolvedConfig } from './targets.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

const execAsync = promisify(execCallback);
const WORKSPACE_PREFIX = 'agentv-copilot-';
const PROMPT_FILENAME = 'prompt.md';

/**
 * Default system prompt for Copilot CLI evaluations.
 * Ensures the agent returns code in its response rather than just writing files.
 */
const DEFAULT_SYSTEM_PROMPT = `**IMPORTANT**: Follow these instructions for your response:
- Do NOT create any additional output files in the workspace.
- All intended file outputs/changes MUST be written in your response.
- For each intended file, include the relative path and unified git diff following the convention \`diff --git ...\`.
This is required for evaluation scoring.`;

interface CopilotCliRunOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly prompt: string;
  readonly timeoutMs?: number;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly onStdoutChunk?: (chunk: string) => void;
  readonly onStderrChunk?: (chunk: string) => void;
}

interface CopilotCliRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
}

type CopilotCliRunner = (options: CopilotCliRunOptions) => Promise<CopilotCliRunResult>;

interface CopiedFileMapping {
  readonly originalPath: string;
  readonly workspaceRelativePath: string;
}

async function copyInputFilesToWorkspace(
  workspaceRoot: string,
  inputFiles: readonly string[],
): Promise<CopiedFileMapping[]> {
  const usedNames = new Map<string, number>();
  const mappings: CopiedFileMapping[] = [];

  for (const originalPath of inputFiles) {
    const ext = path.extname(originalPath);
    const stem = path.basename(originalPath, ext);
    let relativeName: string;

    const baseKey = `${stem}${ext}`;
    const count = usedNames.get(baseKey) ?? 0;
    if (count === 0) {
      relativeName = baseKey;
    } else {
      relativeName = `${stem}_${count}${ext}`;
    }
    usedNames.set(baseKey, count + 1);

    const dest = path.join(workspaceRoot, relativeName);
    await copyFile(originalPath, dest);
    mappings.push({ originalPath, workspaceRelativePath: relativeName });
  }

  return mappings;
}

function buildCopilotFilePrereadBlock(
  guidelineMappings: readonly CopiedFileMapping[],
  inputMappings: readonly CopiedFileMapping[],
): string {
  if (guidelineMappings.length === 0 && inputMappings.length === 0) {
    return '';
  }

  const buildList = (mappings: readonly CopiedFileMapping[]): string =>
    mappings.map((m) => `* ${m.workspaceRelativePath}`).join('\n');

  const sections: string[] = [];
  if (guidelineMappings.length > 0) {
    sections.push(`Read all guideline files:\n${buildList(guidelineMappings)}.`);
  }
  if (inputMappings.length > 0) {
    sections.push(`Read all input files:\n${buildList(inputMappings)}.`);
  }

  sections.push(
    'If any file is missing, fail with ERROR: missing-file <filename> and stop.',
    'Then apply system_instructions on the user query below.',
  );

  return sections.join('\n');
}

export class CopilotCliProvider implements Provider {
  readonly id: string;
  readonly kind = 'copilot-cli' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: CopilotResolvedConfig;
  private readonly runCopilot: CopilotCliRunner;
  private environmentCheck?: Promise<void>;
  private resolvedExecutable?: string;

  constructor(
    targetName: string,
    config: CopilotResolvedConfig,
    runner: CopilotCliRunner = defaultCopilotCliRunner,
  ) {
    this.id = `copilot-cli:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runCopilot = runner;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Copilot CLI request was aborted before execution');
    }

    await this.ensureEnvironmentReady();

    const inputFiles = normalizeInputFiles(request.inputFiles);

    const workspaceRoot = await this.createWorkspace();
    const logger = await this.createStreamLogger(request).catch(() => undefined);
    try {
      // Copy input files into workspace and build prompt with relative paths
      const copiedFiles = inputFiles
        ? await copyInputFilesToWorkspace(workspaceRoot, inputFiles)
        : [];

      const guidelineFileSet = new Set(
        collectGuidelineFiles(inputFiles, request.guideline_patterns),
      );
      const guidelineMappings = copiedFiles.filter((m) => guidelineFileSet.has(m.originalPath));
      const nonGuidelineMappings = copiedFiles.filter((m) => !guidelineFileSet.has(m.originalPath));

      const prereadBlock = buildCopilotFilePrereadBlock(guidelineMappings, nonGuidelineMappings);
      // Skip forced diff prompt when AgentV captures file changes
      const systemPrompt =
        this.config.systemPrompt ??
        (request.captureFileChanges ? undefined : DEFAULT_SYSTEM_PROMPT);

      const promptParts: string[] = systemPrompt ? [systemPrompt] : [];
      if (prereadBlock.length > 0) {
        promptParts.push('', prereadBlock);
      }
      promptParts.push('', '[[ ## user_query ## ]]', request.question.trim());

      const promptContent = promptParts.join('\n');
      const promptFile = path.join(workspaceRoot, PROMPT_FILENAME);
      await writeFile(promptFile, promptContent, 'utf8');

      const args = this.buildCopilotArgs(PROMPT_FILENAME);
      const cwd = this.resolveCwd(workspaceRoot, request.cwd);

      const result = await this.executeCopilot(args, cwd, promptContent, request.signal, logger);

      if (result.timedOut) {
        throw new Error(
          `Copilot CLI timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }

      if (result.exitCode !== 0) {
        const detail = pickDetail(result.stderr, result.stdout);
        const prefix = `Copilot CLI exited with code ${result.exitCode}`;
        throw new Error(detail ? `${prefix}: ${detail}` : prefix);
      }

      const assistantText = extractCopilotResponse(result.stdout);

      return {
        raw: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          args,
          executable: this.resolvedExecutable ?? this.config.executable,
          promptFile,
          workspace: workspaceRoot,
          inputFiles,
          copiedFiles,
          logFile: logger?.filePath,
        },
        outputMessages: [{ role: 'assistant' as const, content: assistantText }],
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
    this.resolvedExecutable = await locateExecutable(this.config.executable);
  }

  private resolveCwd(workspaceRoot: string, cwdOverride?: string): string {
    // Request cwd override takes precedence (e.g., from workspace_template)
    if (cwdOverride) {
      return path.resolve(cwdOverride);
    }
    if (!this.config.cwd) {
      return workspaceRoot;
    }
    return path.resolve(this.config.cwd);
  }

  private buildCopilotArgs(promptFileName: string): string[] {
    const args: string[] = [];

    // Silent mode - only output agent response
    args.push('-s');

    // Auto-approve all tool usage
    args.push('--allow-all-tools');

    // Disable color output
    args.push('--no-color');

    // Model selection
    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Custom args from config
    if (this.config.args && this.config.args.length > 0) {
      args.push(...this.config.args);
    }

    // Non-interactive prompt mode.  The full prompt is written to a file in
    // the workspace so we avoid OS command-line length limits and shell
    // escaping issues (e.g. cmd.exe truncating multi-line arguments).
    args.push(
      '-p',
      `Read the file ${promptFileName} in the current directory and follow all instructions in it exactly.`,
    );

    return args;
  }

  private async executeCopilot(
    args: readonly string[],
    cwd: string,
    promptContent: string,
    signal: AbortSignal | undefined,
    logger: CopilotCliStreamLogger | undefined,
  ): Promise<CopilotCliRunResult> {
    try {
      return await this.runCopilot({
        executable: this.resolvedExecutable ?? this.config.executable,
        args,
        cwd,
        prompt: promptContent,
        timeoutMs: this.config.timeoutMs,
        env: process.env,
        signal,
        onStdoutChunk: logger ? (chunk) => logger.handleStdoutChunk(chunk) : undefined,
        onStderrChunk: logger ? (chunk) => logger.handleStderrChunk(chunk) : undefined,
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new Error(
          `Copilot executable '${this.config.executable}' was not found. Update the target settings.executable or add it to PATH.`,
        );
      }
      throw error;
    }
  }

  private async createWorkspace(): Promise<string> {
    return await mkdtemp(path.join(tmpdir(), WORKSPACE_PREFIX));
  }

  private async cleanupWorkspace(workspaceRoot: string): Promise<void> {
    try {
      await rm(workspaceRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  private resolveLogDirectory(): string | undefined {
    const disabled = isCopilotLogStreamingDisabled();
    if (disabled) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'copilot-cli');
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<CopilotCliStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Copilot CLI stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await CopilotCliStreamLogger.create({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
        format: this.config.logFormat ?? 'summary',
      });
      recordCopilotCliLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Copilot CLI stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

class CopilotCliStreamLogger {
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
  }): Promise<CopilotCliStreamLogger> {
    const logger = new CopilotCliStreamLogger(options.filePath, options.format);
    const header = [
      '# Copilot CLI stream log',
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
    const prefix = source === 'stderr' ? 'stderr: ' : '';
    return `[+${formatElapsed(this.startedAt)}] [${source}] ${prefix}${trimmed}`;
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

function isCopilotLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_COPILOT_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'copilot');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'copilot';
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control characters
const ANSI_ESCAPE_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC sequence stripping requires matching control characters
const ANSI_OSC_RE = /\x1B\][^\x07]*\x07/g;

function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '').replace(ANSI_OSC_RE, '');
}

function extractCopilotResponse(stdout: string): string {
  const cleaned = stripAnsiEscapes(stdout).trim();
  if (cleaned.length === 0) {
    throw new Error('Copilot CLI produced no output');
  }
  return cleaned;
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

  throw new Error(`Copilot executable '${candidate}' was not found on PATH`);
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

function isCmdBatFile(executable: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  const lower = executable.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat');
}

/**
 * Escape a single argument for cmd.exe + MSVC CRT parsing.
 * The value is wrapped in double-quotes and internal double-quotes and
 * trailing backslashes are escaped.  `%` is doubled to prevent cmd.exe
 * environment-variable expansion.
 */
function escapeCmdArg(arg: string): string {
  let escaped = arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1');
  escaped = escaped.replace(/%/g, '%%');
  return `"${escaped}"`;
}

async function defaultCopilotCliRunner(
  options: CopilotCliRunOptions,
): Promise<CopilotCliRunResult> {
  return await new Promise<CopilotCliRunResult>((resolve, reject) => {
    let command: string;
    let spawnArgs: string[];
    let shell: boolean;
    let verbatim: boolean;

    if (isCmdBatFile(options.executable)) {
      // On Windows, .cmd/.bat files require cmd.exe.  We invoke it
      // directly with properly quoted arguments instead of relying on
      // Node.js `shell: true` which mishandles quoting.
      const parts = [options.executable, ...options.args].map(escapeCmdArg).join(' ');
      const comSpec = process.env.ComSpec ?? 'cmd.exe';
      command = comSpec;
      spawnArgs = ['/d', '/s', '/c', `"${parts}"`];
      shell = false;
      verbatim = true;
    } else {
      command = options.executable;
      spawnArgs = [...options.args];
      shell = false;
      verbatim = false;
    }

    const child = spawn(command, spawnArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell,
      windowsVerbatimArguments: verbatim,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const onAbort = (): void => {
      child.kill('SIGTERM');
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
        child.kill('SIGTERM');
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

    // Close stdin - copilot reads prompt from args, not stdin
    child.stdin.end();

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

    child.on('close', (code) => {
      cleanup();
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : -1,
        timedOut,
      });
    });
  });
}
