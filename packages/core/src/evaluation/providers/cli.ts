import { type ExecException, type ExecOptions, exec as execWithCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { readTextFile } from '../file-utils.js';
import type { CliResolvedConfig } from './targets.js';
import type {
  OutputMessage,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
} from './types.js';

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

export type CommandRunner = (
  command: string,
  options: CommandRunOptions,
) => Promise<CommandRunResult>;

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
    shell: process.platform === 'win32' ? 'powershell.exe' : undefined,
  };

  try {
    const { stdout, stderr } = await execAsync(command, execOptions);

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

    return {
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? '',
      exitCode: typeof execError.code === 'number' ? execError.code : null,
      failed: true,
      timedOut: execError.timedOut === true || execError.killed === true,
      signal: execError.signal ?? null,
    };
  }
}

export class CliProvider implements Provider {
  readonly id: string;
  readonly kind = 'cli';
  readonly targetName: string;
  readonly supportsBatch = true;

  private readonly config: CliResolvedConfig;
  private readonly runCommand: CommandRunner;
  private readonly verbose: boolean;
  private readonly keepTempFiles: boolean;
  private healthcheckPromise?: Promise<void>;

  constructor(
    targetName: string,
    config: CliResolvedConfig,
    runner: CommandRunner = defaultCommandRunner,
  ) {
    this.targetName = targetName;
    this.id = `cli:${targetName}`;
    this.config = config;
    this.runCommand = runner;
    this.verbose = config.verbose ?? false;
    this.keepTempFiles = config.keepTempFiles ?? false;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('CLI provider request was aborted before execution');
    }

    await this.ensureHealthy(request.signal);

    const outputFilePath = generateOutputFilePath(request.evalCaseId);
    const templateValues = buildTemplateValues(request, this.config, outputFilePath);
    const renderedCommand = renderTemplate(this.config.commandTemplate, templateValues);

    if (this.verbose) {
      console.log(
        `[cli-provider:${this.targetName}] cwd=${this.config.cwd ?? ''} command=${renderedCommand}`,
      );
    }

    // Measure wall-clock time as fallback for duration
    const startTime = Date.now();
    const result = await this.runCommand(renderedCommand, {
      cwd: this.config.cwd,
      env: process.env,
      timeoutMs: this.config.timeoutMs,
      signal: request.signal,
    });
    const measuredDurationMs = Date.now() - startTime;

    if (result.failed || (result.exitCode ?? 0) !== 0) {
      if (request.signal?.aborted) {
        throw new Error('CLI provider request was aborted');
      }
      if (result.timedOut) {
        throw new Error(
          `CLI provider timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }
      const codeText = result.exitCode !== null ? result.exitCode : 'unknown';
      const detail = result.stderr.trim() || result.stdout.trim();
      const message = detail
        ? `${detail} (exit code ${codeText})`
        : `CLI exited with code ${codeText}`;
      throw new Error(message);
    }

    // Read from output file and parse as JSON if possible
    const responseContent = await this.readAndCleanupOutputFile(outputFilePath);
    const parsed = this.parseOutputContent(responseContent);

    return {
      outputMessages: parsed.outputMessages,
      tokenUsage: parsed.tokenUsage,
      costUsd: parsed.costUsd,
      durationMs: parsed.durationMs ?? measuredDurationMs,
      raw: {
        command: renderedCommand,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0,
        cwd: this.config.cwd,
        outputFile: outputFilePath,
      },
    };
  }

  async invokeBatch(requests: readonly ProviderRequest[]): Promise<readonly ProviderResponse[]> {
    if (requests.length === 0) {
      return [];
    }

    for (const request of requests) {
      if (request.signal?.aborted) {
        throw new Error('CLI provider batch request was aborted before execution');
      }
    }

    const controller = new AbortController();
    for (const request of requests) {
      request.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    }

    await this.ensureHealthy(controller.signal);

    const outputFilePath = generateOutputFilePath('batch', '.jsonl');

    const batchInputFiles: string[] = [];
    for (const request of requests) {
      if (request.inputFiles && request.inputFiles.length > 0) {
        batchInputFiles.push(...request.inputFiles);
      }
    }

    const templateValues = buildTemplateValues(
      {
        question: '',
        guidelines: '',
        inputFiles: batchInputFiles,
        evalCaseId: 'batch',
        attempt: 0,
      },
      this.config,
      outputFilePath,
    );
    const renderedCommand = renderTemplate(this.config.commandTemplate, templateValues);

    if (this.verbose) {
      console.log(
        `[cli-provider:${this.targetName}] (batch size=${requests.length}) cwd=${this.config.cwd ?? ''} command=${renderedCommand}`,
      );
    }

    // Measure wall-clock time for batch (used as fallback if records don't provide duration)
    const startTime = Date.now();
    const result = await this.runCommand(renderedCommand, {
      cwd: this.config.cwd,
      env: process.env,
      timeoutMs: this.config.timeoutMs,
      signal: controller.signal,
    });
    const measuredDurationMs = Date.now() - startTime;

    if (result.failed || (result.exitCode ?? 0) !== 0) {
      if (controller.signal.aborted) {
        throw new Error('CLI provider request was aborted');
      }
      if (result.timedOut) {
        throw new Error(
          `CLI provider timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }
      const codeText = result.exitCode !== null ? result.exitCode : 'unknown';
      const detail = result.stderr.trim() || result.stdout.trim();
      const message = detail
        ? `${detail} (exit code ${codeText})`
        : `CLI exited with code ${codeText}`;
      throw new Error(message);
    }

    const responseContent = await this.readAndCleanupOutputFile(outputFilePath);
    const recordsById = this.parseJsonlBatchOutput(responseContent);

    const requestedIds = requests
      .map((request) => request.evalCaseId)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const missingIds = requestedIds.filter((id) => !recordsById.has(id));
    if (missingIds.length > 0) {
      throw new Error(`CLI batch output missing ids: ${missingIds.join(', ')}`);
    }

    // Calculate per-request fallback duration (total time / number of requests)
    const perRequestFallbackMs = Math.round(measuredDurationMs / requests.length);

    const responses: ProviderResponse[] = requests.map((request) => {
      const evalCaseId = request.evalCaseId;
      if (!evalCaseId) {
        return {
          outputMessages: [],
          durationMs: perRequestFallbackMs,
          raw: {
            command: renderedCommand,
            stderr: result.stderr,
            exitCode: result.exitCode ?? 0,
            cwd: this.config.cwd,
            outputFile: outputFilePath,
          },
        };
      }

      const parsed = recordsById.get(evalCaseId);
      if (!parsed) {
        return {
          outputMessages: [],
          durationMs: perRequestFallbackMs,
          raw: {
            command: renderedCommand,
            stderr: result.stderr,
            exitCode: result.exitCode ?? 0,
            cwd: this.config.cwd,
            outputFile: outputFilePath,
          },
        };
      }

      return {
        outputMessages: parsed.outputMessages,
        tokenUsage: parsed.tokenUsage,
        costUsd: parsed.costUsd,
        durationMs: parsed.durationMs ?? perRequestFallbackMs,
        raw: {
          command: renderedCommand,
          stderr: result.stderr,
          exitCode: result.exitCode ?? 0,
          cwd: this.config.cwd,
          outputFile: outputFilePath,
          recordId: evalCaseId,
        },
      };
    });

    return responses;
  }

  /**
   * Parse output content from CLI.
   * If the content is valid JSON with 'output_messages' or 'text' field, extract them.
   * If only 'text' is provided, wrap it in outputMessages.
   * Otherwise, treat the entire content as plain text wrapped in outputMessages.
   *
   * Also extracts optional execution metrics:
   * - token_usage: { input, output, cached? }
   * - cost_usd: number
   * - duration_ms: number
   */
  private parseOutputContent(content: string): {
    outputMessages: readonly OutputMessage[];
    tokenUsage?: ProviderTokenUsage;
    costUsd?: number;
    durationMs?: number;
  } {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as {
          text?: unknown;
          output_messages?: unknown;
          token_usage?: unknown;
          cost_usd?: unknown;
          duration_ms?: unknown;
        };

        // Parse execution metrics
        const tokenUsage = this.parseTokenUsage(obj.token_usage);
        const costUsd =
          typeof obj.cost_usd === 'number' && obj.cost_usd >= 0 ? obj.cost_usd : undefined;
        const durationMs =
          typeof obj.duration_ms === 'number' && obj.duration_ms >= 0 ? obj.duration_ms : undefined;

        const outputMessages = this.parseOutputMessages(obj.output_messages);

        // If output_messages provided, use it
        if (outputMessages && outputMessages.length > 0) {
          return { outputMessages, tokenUsage, costUsd, durationMs };
        }

        // Fall back to text field, wrap in outputMessages
        if ('text' in obj) {
          const text = typeof obj.text === 'string' ? obj.text : String(obj.text);
          return {
            outputMessages: [{ role: 'assistant', content: text }],
            tokenUsage,
            costUsd,
            durationMs,
          };
        }
      }
    } catch {
      // Not valid JSON, treat as plain text
    }
    // Plain text content, wrap in outputMessages
    return { outputMessages: [{ role: 'assistant', content }] };
  }

  /**
   * Parse token_usage from CLI output.
   */
  private parseTokenUsage(tokenUsage: unknown): ProviderTokenUsage | undefined {
    if (typeof tokenUsage !== 'object' || tokenUsage === null) {
      return undefined;
    }

    const obj = tokenUsage as { input?: unknown; output?: unknown; cached?: unknown };

    if (typeof obj.input !== 'number' || typeof obj.output !== 'number') {
      return undefined;
    }

    return {
      input: obj.input,
      output: obj.output,
      cached: typeof obj.cached === 'number' ? obj.cached : undefined,
    };
  }

  /**
   * Parse output_messages from JSONL (snake_case) and convert to OutputMessage[] (camelCase).
   */
  private parseOutputMessages(outputMessages: unknown): readonly OutputMessage[] | undefined {
    if (!Array.isArray(outputMessages)) {
      return undefined;
    }

    const messages: OutputMessage[] = [];
    for (const msg of outputMessages) {
      if (typeof msg !== 'object' || msg === null) {
        continue;
      }

      const rawMsg = msg as {
        role?: unknown;
        name?: unknown;
        content?: unknown;
        tool_calls?: unknown;
        timestamp?: unknown;
        metadata?: unknown;
      };

      // Role is required
      if (typeof rawMsg.role !== 'string') {
        continue;
      }

      const message: OutputMessage = {
        role: rawMsg.role,
        name: typeof rawMsg.name === 'string' ? rawMsg.name : undefined,
        content: rawMsg.content,
        toolCalls: this.parseToolCalls(rawMsg.tool_calls),
        timestamp: typeof rawMsg.timestamp === 'string' ? rawMsg.timestamp : undefined,
        metadata:
          typeof rawMsg.metadata === 'object' && rawMsg.metadata !== null
            ? (rawMsg.metadata as Record<string, unknown>)
            : undefined,
      };

      messages.push(message);
    }

    return messages.length > 0 ? messages : undefined;
  }

  /**
   * Parse tool_calls from JSONL (snake_case) and convert to ToolCall[] format.
   */
  private parseToolCalls(toolCalls: unknown):
    | readonly {
        tool: string;
        input?: unknown;
        output?: unknown;
        id?: string;
        timestamp?: string;
      }[]
    | undefined {
    if (!Array.isArray(toolCalls)) {
      return undefined;
    }

    const calls: {
      tool: string;
      input?: unknown;
      output?: unknown;
      id?: string;
      timestamp?: string;
    }[] = [];
    for (const call of toolCalls) {
      if (typeof call !== 'object' || call === null) {
        continue;
      }

      const rawCall = call as {
        tool?: unknown;
        input?: unknown;
        output?: unknown;
        id?: unknown;
        timestamp?: unknown;
      };

      // Tool name is required
      if (typeof rawCall.tool !== 'string') {
        continue;
      }

      calls.push({
        tool: rawCall.tool,
        input: rawCall.input,
        output: rawCall.output,
        id: typeof rawCall.id === 'string' ? rawCall.id : undefined,
        timestamp: typeof rawCall.timestamp === 'string' ? rawCall.timestamp : undefined,
      });
    }

    return calls.length > 0 ? calls : undefined;
  }

  private parseJsonlBatchOutput(content: string): Map<
    string,
    {
      outputMessages: readonly OutputMessage[];
      tokenUsage?: ProviderTokenUsage;
      costUsd?: number;
      durationMs?: number;
    }
  > {
    const records = new Map<
      string,
      {
        outputMessages: readonly OutputMessage[];
        tokenUsage?: ProviderTokenUsage;
        costUsd?: number;
        durationMs?: number;
      }
    >();

    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`CLI batch output contains invalid JSONL line: ${reason}`);
      }

      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('CLI batch output JSONL line must be an object');
      }

      const obj = parsed as {
        id?: unknown;
        text?: unknown;
        output_messages?: unknown;
        token_usage?: unknown;
        cost_usd?: unknown;
        duration_ms?: unknown;
      };
      const id = typeof obj.id === 'string' ? obj.id : undefined;
      if (!id || id.trim().length === 0) {
        throw new Error('CLI batch output JSONL line missing required string field: id');
      }

      if (records.has(id)) {
        throw new Error(`CLI batch output contains duplicate id: ${id}`);
      }

      // Parse execution metrics
      const tokenUsage = this.parseTokenUsage(obj.token_usage);
      const costUsd =
        typeof obj.cost_usd === 'number' && obj.cost_usd >= 0 ? obj.cost_usd : undefined;
      const durationMs =
        typeof obj.duration_ms === 'number' && obj.duration_ms >= 0 ? obj.duration_ms : undefined;

      // Prefer output_messages, fall back to text wrapped in outputMessages
      const parsedOutputMessages = this.parseOutputMessages(obj.output_messages);
      let outputMessages: readonly OutputMessage[];
      if (parsedOutputMessages && parsedOutputMessages.length > 0) {
        outputMessages = parsedOutputMessages;
      } else {
        // Fall back to text field
        const text =
          typeof obj.text === 'string'
            ? obj.text
            : obj.text === undefined
              ? ''
              : JSON.stringify(obj.text);
        outputMessages = text ? [{ role: 'assistant', content: text }] : [];
      }

      records.set(id, {
        outputMessages,
        tokenUsage,
        costUsd,
        durationMs,
      });
    }

    return records;
  }

  private async readAndCleanupOutputFile(filePath: string): Promise<string> {
    try {
      const content = await readTextFile(filePath);
      return content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read output file '${filePath}': ${errorMsg}`);
    } finally {
      // Clean up temp file - ignore errors as the file might not exist on read failure
      if (!this.keepTempFiles) {
        await fs.unlink(filePath).catch(() => {
          /* ignore cleanup errors */
        });
      }
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
    healthcheck: CliResolvedConfig['healthcheck'],
    signal?: AbortSignal,
  ): Promise<void> {
    if (!healthcheck) {
      return;
    }

    const timeoutMs = healthcheck.timeoutMs ?? this.config.timeoutMs;

    if (healthcheck.type === 'http') {
      const controller = new AbortController();
      const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      signal?.addEventListener('abort', () => controller.abort(), { once: true });

      try {
        const response = await fetch(healthcheck.url, { method: 'GET', signal: controller.signal });
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
          question: '',
          guidelines: '',
          inputFiles: [],
          evalCaseId: 'healthcheck',
          attempt: 0,
        },
        this.config,
        generateOutputFilePath('healthcheck'),
      ),
    );
    if (this.verbose) {
      console.log(
        `[cli-provider:${this.targetName}] (healthcheck) cwd=${healthcheck.cwd ?? this.config.cwd ?? ''} command=${renderedCommand}`,
      );
    }

    const result = await this.runCommand(renderedCommand, {
      cwd: healthcheck.cwd ?? this.config.cwd,
      env: process.env,
      timeoutMs,
      signal,
    });

    if (result.failed || (result.exitCode ?? 0) !== 0) {
      const codeText = result.exitCode !== null ? result.exitCode : 'unknown';
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
    'question' | 'guidelines' | 'inputFiles' | 'evalCaseId' | 'attempt'
  >,
  config: CliResolvedConfig,
  outputFilePath: string,
): Record<string, string> {
  const inputFiles = normalizeInputFiles(request.inputFiles);
  return {
    PROMPT: shellEscape(request.question ?? ''),
    GUIDELINES: shellEscape(request.guidelines ?? ''),
    EVAL_ID: shellEscape(request.evalCaseId ?? ''),
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
    return '';
  }

  const formatter = template ?? '{path}';
  return files
    .map((filePath) => {
      const escapedPath = shellEscape(filePath);
      const escapedName = shellEscape(path.basename(filePath));
      return formatter.replaceAll('{path}', escapedPath).replaceAll('{basename}', escapedName);
    })
    .join(' ');
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

  if (process.platform === 'win32') {
    // PowerShell uses backtick (`) for escaping, not backslash
    // Double quotes inside the string need to be escaped with backtick
    // Single quotes can be used instead for simpler escaping
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function generateOutputFilePath(evalCaseId?: string, extension = '.json'): string {
  const safeEvalId = evalCaseId || 'unknown';
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return path.join(os.tmpdir(), `agentv-${safeEvalId}-${timestamp}-${random}${extension}`);
}

function formatTimeoutSuffix(timeoutMs: number | undefined): string {
  if (!timeoutMs || timeoutMs <= 0) {
    return '';
  }
  const seconds = Math.ceil(timeoutMs / 1000);
  return ` after ${seconds}s`;
}
