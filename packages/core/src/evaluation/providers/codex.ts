import { randomUUID } from "node:crypto";
import { exec as execCallback, spawn } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { access, copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { buildPromptDocument, collectGuidelineFiles, normalizeInputFiles } from "./preread.js";
import type { CodexResolvedConfig } from "./targets.js";
import type { Provider, ProviderRequest, ProviderResponse } from "./types.js";

const execAsync = promisify(execCallback);
const WORKSPACE_PREFIX = "agentv-codex-";
const PROMPT_FILENAME = "prompt.md";
const FILES_DIR = "files";
const JSONL_TYPE_ITEM_COMPLETED = "item.completed";

interface CodexRunOptions {
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

interface CodexRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
}

type CodexRunner = (options: CodexRunOptions) => Promise<CodexRunResult>;

export class CodexProvider implements Provider {
  readonly id: string;
  readonly kind = "codex" as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: CodexResolvedConfig;
  private readonly runCodex: CodexRunner;
  private environmentCheck?: Promise<void>;
  private resolvedExecutable?: string;

  constructor(targetName: string, config: CodexResolvedConfig, runner: CodexRunner = defaultCodexRunner) {
    this.id = `codex:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runCodex = runner;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error("Codex provider request was aborted before execution");
    }

    await this.ensureEnvironmentReady();

    const inputFiles = normalizeInputFiles(request.inputFiles);
    const originalGuidelines = new Set(
      collectGuidelineFiles(inputFiles, request.guideline_patterns).map((file) => path.resolve(file)),
    );

    const workspaceRoot = await this.createWorkspace();
    const logger = await this.createStreamLogger(request).catch(() => undefined);
    try {
      const { mirroredInputFiles, guidelineMirrors } = await this.mirrorInputFiles(
        inputFiles,
        workspaceRoot,
        originalGuidelines,
      );

      const promptContent = buildPromptDocument(request, mirroredInputFiles, {
        guidelinePatterns: request.guideline_patterns,
        guidelineOverrides: guidelineMirrors,
      });
      const promptFile = path.join(workspaceRoot, PROMPT_FILENAME);
      await writeFile(promptFile, promptContent, "utf8");

      const args = this.buildCodexArgs();
      const cwd = this.resolveCwd(workspaceRoot);

      const result = await this.executeCodex(args, cwd, promptContent, request.signal, logger);

      if (result.timedOut) {
        throw new Error(
          `Codex CLI timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }

      if (result.exitCode !== 0) {
        const detail = pickDetail(result.stderr, result.stdout);
        const prefix = `Codex CLI exited with code ${result.exitCode}`;
        throw new Error(detail ? `${prefix}: ${detail}` : prefix);
      }

      const parsed = parseCodexJson(result.stdout);
      const assistantText = extractAssistantText(parsed);

      return {
        text: assistantText,
        raw: {
          response: parsed,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          args,
          executable: this.resolvedExecutable ?? this.config.executable,
          promptFile,
          workspace: workspaceRoot,
          inputFiles: mirroredInputFiles,
          logFile: logger?.filePath,
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
    this.resolvedExecutable = await locateExecutable(this.config.executable);
  }

  private resolveCwd(workspaceRoot: string): string {
    if (!this.config.cwd) {
      return workspaceRoot;
    }
    return path.resolve(this.config.cwd);
  }

  private buildCodexArgs(): string[] {
    // Global flags must come before 'exec' subcommand
    const args = ["--ask-for-approval", "never", "exec", "--json", "--color", "never", "--skip-git-repo-check"];
    if (this.config.args && this.config.args.length > 0) {
      args.push(...this.config.args);
    }
    args.push("-");
    return args;
  }

  private async executeCodex(
    args: readonly string[],
    cwd: string,
    promptContent: string,
    signal: AbortSignal | undefined,
    logger: CodexStreamLogger | undefined,
  ): Promise<CodexRunResult> {
    try {
      return await this.runCodex({
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
      if (err.code === "ENOENT") {
        throw new Error(
          `Codex executable '${this.config.executable}' was not found. Update the target settings.executable or add it to PATH.`,
        );
      }
      throw error;
    }
  }

  private async mirrorInputFiles(
    inputFiles: readonly string[] | undefined,
    workspaceRoot: string,
    guidelineOriginals: ReadonlySet<string>,
  ): Promise<{
    readonly mirroredInputFiles: readonly string[] | undefined;
    readonly guidelineMirrors: ReadonlySet<string>;
  }> {
    if (!inputFiles || inputFiles.length === 0) {
      return {
        mirroredInputFiles: undefined,
        guidelineMirrors: new Set<string>(),
      };
    }

    const filesRoot = path.join(workspaceRoot, FILES_DIR);
    await mkdir(filesRoot, { recursive: true });

    const mirrored: string[] = [];
    const guidelineMirrors = new Set<string>();
    const nameCounts = new Map<string, number>();

    for (const inputFile of inputFiles) {
      const absoluteSource = path.resolve(inputFile);
      const baseName = path.basename(absoluteSource);
      const count = nameCounts.get(baseName) ?? 0;
      nameCounts.set(baseName, count + 1);
      const finalName = count === 0 ? baseName : `${baseName}.${count}`;
      const destination = path.join(filesRoot, finalName);
      await copyFile(absoluteSource, destination);
      const resolvedDestination = path.resolve(destination);
      mirrored.push(resolvedDestination);
      if (guidelineOriginals.has(absoluteSource)) {
        guidelineMirrors.add(resolvedDestination);
      }
    }

    return {
      mirroredInputFiles: mirrored,
      guidelineMirrors,
    };
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
    const disabled = isCodexLogStreamingDisabled();
    if (disabled) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), ".agentv", "logs", "codex");
  }

  private async createStreamLogger(request: ProviderRequest): Promise<CodexStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
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
        format: this.config.logFormat ?? "summary",
      });
      console.log(`Streaming Codex CLI output to ${filePath}`);
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Codex stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

class CodexStreamLogger {
  readonly filePath: string;
  private readonly stream: WriteStream;
  private readonly startedAt = Date.now();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly format: "summary" | "json";

  private constructor(filePath: string, format: "summary" | "json") {
    this.filePath = filePath;
    this.format = format;
    this.stream = createWriteStream(filePath, { flags: "a" });
  }

  static async create(options: {
    readonly filePath: string;
    readonly targetName: string;
    readonly evalCaseId?: string;
    readonly attempt?: number;
    readonly format: "summary" | "json";
  }): Promise<CodexStreamLogger> {
    const logger = new CodexStreamLogger(options.filePath, options.format);
    const header = [
      "# Codex CLI stream log",
      `# target: ${options.targetName}`,
      options.evalCaseId ? `# eval: ${options.evalCaseId}` : undefined,
      options.attempt !== undefined ? `# attempt: ${options.attempt + 1}` : undefined,
      `# started: ${new Date().toISOString()}`,
      "",
    ].filter((line): line is string => Boolean(line));
    logger.writeLines(header);
    return logger;
  }

  handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    this.flushBuffer("stdout");
  }

  handleStderrChunk(chunk: string): void {
    this.stderrBuffer += chunk;
    this.flushBuffer("stderr");
  }

  async close(): Promise<void> {
    this.flushBuffer("stdout");
    this.flushBuffer("stderr");
    this.flushRemainder();
    await new Promise<void>((resolve, reject) => {
      this.stream.once("error", reject);
      this.stream.end(() => resolve());
    });
  }

  private writeLines(lines: readonly string[]): void {
    for (const line of lines) {
      this.stream.write(`${line}\n`);
    }
  }

  private flushBuffer(source: "stdout" | "stderr"): void {
    const buffer = source === "stdout" ? this.stdoutBuffer : this.stderrBuffer;
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    if (source === "stdout") {
      this.stdoutBuffer = remainder;
    } else {
      this.stderrBuffer = remainder;
    }
    for (const line of lines) {
      const formatted = this.formatLine(line, source);
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write("\n");
      }
    }
  }

  private formatLine(rawLine: string, source: "stdout" | "stderr"): string | undefined {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const message =
      this.format === "json"
        ? formatCodexJsonLog(trimmed)
        : formatCodexLogMessage(trimmed, source);
    return `[+${formatElapsed(this.startedAt)}] [${source}] ${message}`;
  }

  private flushRemainder(): void {
    const stdoutRemainder = this.stdoutBuffer.trim();
    if (stdoutRemainder.length > 0) {
      const formatted = this.formatLine(stdoutRemainder, "stdout");
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write("\n");
      }
    }
    const stderrRemainder = this.stderrBuffer.trim();
    if (stderrRemainder.length > 0) {
      const formatted = this.formatLine(stderrRemainder, "stderr");
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write("\n");
      }
    }
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
  }
}

function isCodexLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_CODEX_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === "false" || normalized === "0" || normalized === "off";
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evalId = sanitizeForFilename(request.evalCaseId ?? "codex");
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : "";
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "_");
  return sanitized.length > 0 ? sanitized : "codex";
}

function formatElapsed(startedAt: number): string {
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatCodexLogMessage(rawLine: string, source: "stdout" | "stderr"): string {
  const parsed = tryParseJsonValue(rawLine);
  if (parsed) {
    const summary = summarizeCodexEvent(parsed);
    if (summary) {
      return summary;
    }
  }
  if (source === "stderr") {
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
  if (!event || typeof event !== "object") {
    return undefined;
  }
  const record = event as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  let message = extractFromEvent(event) ?? extractFromItem(record.item) ?? flattenContent(record.output ?? record.content);
  if (!message && type === JSONL_TYPE_ITEM_COMPLETED) {
    const item = record.item;
    if (item && typeof item === "object") {
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
      typeof (record.item as Record<string, unknown> | undefined)?.type === "string"
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
  const includesPathSeparator = candidate.includes("/") || candidate.includes("\\");
  if (includesPathSeparator) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
    const executablePath = await ensureWindowsExecutableVariant(resolved);
    await access(executablePath, constants.F_OK);
    return executablePath;
  }

  const locator = process.platform === "win32" ? "where" : "which";
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
  if (process.platform !== "win32") {
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
  if (process.platform !== "win32") {
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

const DEFAULT_WINDOWS_EXTENSIONS = [".com", ".exe", ".bat", ".cmd", ".ps1"] as const;

function getWindowsExecutableExtensions(): readonly string[] {
  if (process.platform !== "win32") {
    return [];
  }
  const fromEnv = process.env.PATHEXT?.split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0);
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_WINDOWS_EXTENSIONS;
}

function parseCodexJson(output: string): unknown {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new Error("Codex CLI produced no output in --json mode");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const lineObjects = parseJsonLines(trimmed);
    if (lineObjects) {
      return lineObjects;
    }
    const lastBrace = trimmed.lastIndexOf("{");
    if (lastBrace >= 0) {
      const candidate = trimmed.slice(lastBrace);
      try {
        return JSON.parse(candidate);
      } catch {
        // fallthrough
      }
    }
    const preview = trimmed.slice(0, 200);
    throw new Error(`Codex CLI emitted invalid JSON: ${preview}${trimmed.length > 200 ? "…" : ""}`);
  }
}

function extractAssistantText(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    const text = extractFromEventStream(parsed);
    if (text) {
      return text;
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Codex CLI JSON response did not include an assistant message");
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
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const role = (entry as Record<string, unknown>).role;
      if (role !== "assistant") {
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
  if (response && typeof response === "object") {
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

  throw new Error("Codex CLI JSON response did not include an assistant message");
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
  if (!event || typeof event !== "object") {
    return undefined;
  }
  const record = event as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
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

function extractFromItem(item: unknown): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  const itemType = typeof record.type === "string" ? record.type : undefined;
  if (itemType === "agent_message" || itemType === "response" || itemType === "output") {
    const text = flattenContent(record.text ?? record.content ?? record.output);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function flattenContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((segment) => {
        if (typeof segment === "string") {
          return segment;
        }
        if (segment && typeof segment === "object" && "text" in segment) {
          const text = (segment as Record<string, unknown>).text;
          return typeof text === "string" ? text : undefined;
        }
        return undefined;
      })
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    return parts.length > 0 ? parts.join(" \n") : undefined;
  }
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as Record<string, unknown>).text;
    return typeof text === "string" ? text : undefined;
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
    return "";
  }
  const seconds = Math.ceil(timeoutMs / 1000);
  return ` after ${seconds}s`;
}

async function defaultCodexRunner(options: CodexRunOptions): Promise<CodexRunResult> {
  return await new Promise<CodexRunResult>((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: shouldShellExecute(options.executable),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const onAbort = (): void => {
      child.kill("SIGTERM");
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
      timeoutHandle.unref?.();
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    child.stdin.end(options.prompt);

    const cleanup = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    };

    child.on("error", (error) => {
      cleanup();
      reject(error);
    });

    child.on("close", (code) => {
      cleanup();
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : -1,
        timedOut,
      });
    });
  });
}

function shouldShellExecute(executable: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  const lower = executable.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat") || lower.endsWith(".ps1");
}
