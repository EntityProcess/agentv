import { exec as execWithCallback, type ExecException, type ExecOptions } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { CliResolvedConfig } from "./targets.js";
import type { Provider, ProviderRequest, ProviderResponse } from "./types.js";

const execAsync = promisify(execWithCallback);
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB to accommodate verbose CLI output

export interface CommandRunOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CommandRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly failed: boolean;
  readonly timedOut?: boolean;
  readonly signal?: NodeJS.Signals | null;
}

export type CommandRunner = (command: string, options: CommandRunOptions) => Promise<CommandRunResult>;

async function defaultCommandRunner(
  command: string,
  options: CommandRunOptions,
): Promise<CommandRunResult> {
  const execOptions: ExecOptions = {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeoutMs,
    signal: options.signal,
    maxBuffer: DEFAULT_MAX_BUFFER,
    shell: process.platform === "win32" ? "powershell.exe" : undefined,
  };

  try {
    const { stdout, stderr } = await execAsync(command, execOptions);
    console.error(`[CLI DEBUG] SUCCESS - stdout: ${stdout.length} bytes, stderr: ${stderr.length} bytes`);
    
    return {
      stdout,
      stderr,
      exitCode: 0,
      failed: false,
      timedOut: false,
      signal: null,
    };
  } catch (error) {
    const execError = error as ExecException & {
      stdout?: string;
      stderr?: string;
      timedOut?: boolean;
      killed?: boolean;
    };

    console.error(`[CLI DEBUG] ERROR - code: ${execError.code}, message: ${execError.message}`);
    console.error(`[CLI DEBUG] stdout: ${execError.stdout?.length ?? 0} bytes, stderr: ${execError.stderr?.length ?? 0} bytes`);

    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: typeof execError.code === "number" ? execError.code : null,
      failed: true,
      timedOut: execError.timedOut === true || execError.killed === true,
      signal: execError.signal ?? null,
    };
  }
}

export class CliProvider implements Provider {
  readonly id: string;
  readonly kind = "cli";
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: CliResolvedConfig;
  private readonly runCommand: CommandRunner;
  private healthcheckPromise?: Promise<void>;

  constructor(targetName: string, config: CliResolvedConfig, runner: CommandRunner = defaultCommandRunner) {
    this.targetName = targetName;
    this.id = `cli:${targetName}`;
    this.config = config;
    this.runCommand = runner;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error("CLI provider request was aborted before execution");
    }

    await this.ensureHealthy(request.signal);

    const outputFilePath = generateOutputFilePath(request.evalCaseId);
    const templateValues = buildTemplateValues(request, this.config, outputFilePath);
    const renderedCommand = renderTemplate(this.config.commandTemplate, templateValues);

    const env = this.config.env ? { ...process.env, ...this.config.env } : process.env;
    const result = await this.runCommand(renderedCommand, {
      cwd: this.config.cwd,
      env,
      timeoutMs: this.config.timeoutMs,
      signal: request.signal,
    });

    if (result.failed || (result.exitCode ?? 0) !== 0) {
      if (request.signal?.aborted) {
        throw new Error("CLI provider request was aborted");
      }
      if (result.timedOut) {
        throw new Error(
          `CLI provider timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }
      const codeText = result.exitCode !== null ? result.exitCode : "unknown";
      const detail = result.stderr.trim() || result.stdout.trim();
      const message = detail ? `${detail} (exit code ${codeText})` : `CLI exited with code ${codeText}`;
      throw new Error(message);
    }

    // Read from output file
    const responseText = await this.readAndCleanupOutputFile(outputFilePath);

    return {
      text: responseText,
      raw: {
        command: renderedCommand,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0,
        cwd: this.config.cwd,
        outputFile: outputFilePath,
      },
    };
  }

  private async readAndCleanupOutputFile(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read output file '${filePath}': ${errorMsg}`);
    } finally {
      // Clean up temp file - ignore errors as the file might not exist on read failure
      await fs.unlink(filePath).catch(() => {/* ignore cleanup errors */});
    }
  }

  private async ensureHealthy(signal?: AbortSignal): Promise<void> {
    if (!this.config.healthcheck) {
      return;
    }
    if (!this.healthcheckPromise) {
      this.healthcheckPromise = this.runHealthcheck(this.config.healthcheck, signal);
    }
    return this.healthcheckPromise;
  }

  private async runHealthcheck(
    healthcheck: CliResolvedConfig["healthcheck"],
    signal?: AbortSignal,
  ): Promise<void> {
    if (!healthcheck) {
      return;
    }

    const timeoutMs = healthcheck.timeoutMs ?? this.config.timeoutMs;

    if (healthcheck.type === "http") {
      const controller = new AbortController();
      const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      signal?.addEventListener("abort", () => controller.abort(), { once: true });

      try {
        const response = await fetch(healthcheck.url, { method: "GET", signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`CLI healthcheck failed for '${this.targetName}': ${reason}`);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
      return;
    }

    const renderedCommand = renderTemplate(
      healthcheck.commandTemplate,
      buildTemplateValues(
        {
          question: "",
          guidelines: "",
          inputFiles: [],
          evalCaseId: "healthcheck",
          attempt: 0,
        },
        this.config,
        generateOutputFilePath("healthcheck"),
      ),
    );

    const env = this.config.env ? { ...process.env, ...this.config.env } : process.env;
    const result = await this.runCommand(renderedCommand, {
      cwd: healthcheck.cwd ?? this.config.cwd,
      env,
      timeoutMs,
      signal,
    });

    if (result.failed || (result.exitCode ?? 0) !== 0) {
      const codeText = result.exitCode !== null ? result.exitCode : "unknown";
      const detail = result.stderr.trim() || result.stdout.trim();
      const message = detail
        ? `${detail} (exit code ${codeText})`
        : `CLI healthcheck command exited with code ${codeText}`;
      throw new Error(`CLI healthcheck failed for '${this.targetName}': ${message}`);
    }
  }
}

function buildTemplateValues(
  request: Pick<
    ProviderRequest,
    "question" | "guidelines" | "inputFiles" | "evalCaseId" | "attempt"
  >,
  config: CliResolvedConfig,
  outputFilePath: string,
): Record<string, string> {
  const inputFiles = normalizeInputFiles(request.inputFiles);
  return {
    PROMPT: shellEscape(request.question ?? ""),
    GUIDELINES: shellEscape(request.guidelines ?? ""),
    EVAL_ID: shellEscape(request.evalCaseId ?? ""),
    ATTEMPT: shellEscape(String(request.attempt ?? 0)),
    FILES: formatFileList(inputFiles, config.filesFormat),
    OUTPUT_FILE: shellEscape(outputFilePath),
  };
}

function normalizeInputFiles(
  inputFiles: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!inputFiles || inputFiles.length === 0) {
    return undefined;
  }

  const unique = new Map<string, string>();
  for (const inputFile of inputFiles) {
    const absolutePath = path.resolve(inputFile);
    if (!unique.has(absolutePath)) {
      unique.set(absolutePath, absolutePath);
    }
  }

  return Array.from(unique.values());
}

function formatFileList(
  files: readonly string[] | undefined,
  template: string | undefined,
): string {
  if (!files || files.length === 0) {
    return "";
  }

  const formatter = template ?? "{path}";
  return files
    .map((filePath) => {
      const escapedPath = shellEscape(filePath);
      const escapedName = shellEscape(path.basename(filePath));
      return formatter.replaceAll("{path}", escapedPath).replaceAll("{basename}", escapedName);
    })
    .join(" ");
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Z_]+)\}/g, (match, key) => {
    const replacement = values[key];
    return replacement !== undefined ? replacement : match;
  });
}

function shellEscape(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  if (process.platform === "win32") {
    // PowerShell uses backtick (`) for escaping, not backslash
    // Double quotes inside the string need to be escaped with backtick
    // Single quotes can be used instead for simpler escaping
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function generateOutputFilePath(evalCaseId?: string): string {
  const safeEvalId = evalCaseId || "unknown";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return path.join(os.tmpdir(), `agentv-${safeEvalId}-${timestamp}-${random}.json`);
}

function formatTimeoutSuffix(timeoutMs: number | undefined): string {
  if (!timeoutMs || timeoutMs <= 0) {
    return "";
  }
  const seconds = Math.ceil(timeoutMs / 1000);
  return ` after ${seconds}s`;
}
