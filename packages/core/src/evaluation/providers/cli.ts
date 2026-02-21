import { type ExecException, type ExecOptions, exec as execWithCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import { readTextFile } from '../file-utils.js';
import type { CliResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
} from './types.js';

// ---------------------------------------------------------------------------
// Zod Schemas for CLI Output Parsing
// ---------------------------------------------------------------------------

/**
 * Schema for tool calls in output messages.
 * Validates tool_calls array items from CLI JSON output.
 */
const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  id: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  duration_ms: z.number().optional(),
});

/**
 * Schema for individual output messages.
 * Validates output_messages array items from CLI JSON output.
 * Uses snake_case field names matching JSONL convention.
 */
const MessageInputSchema = z.object({
  role: z.string(),
  name: z.string().optional(),
  content: z.unknown().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  duration_ms: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Schema for token usage metrics.
 * Validates token_usage object from CLI JSON output.
 */
const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cached: z.number().optional(),
});

/**
 * Schema for CLI single output JSON structure.
 * Validates the complete JSON output from a single CLI invocation.
 * All fields are optional to support various output formats.
 */
const CliOutputSchema = z.object({
  text: z.unknown().optional(),
  output_messages: z.array(MessageInputSchema).optional(),
  token_usage: TokenUsageSchema.optional(),
  cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
});

/**
 * Schema for CLI JSONL batch output records.
 * Extends CliOutputSchema with required 'id' field for batch processing.
 */
const CliJsonlRecordSchema = CliOutputSchema.extend({
  id: z.string().min(1),
});

// Type for parsed output messages from Zod schema
type ParsedMessage = z.infer<typeof MessageInputSchema>;

/**
 * Validates cost_usd and duration_ms values, warning and discarding negative values.
 * Returns sanitized values (undefined if negative).
 */
function validateMetrics(
  costUsd: number | undefined,
  durationMs: number | undefined,
  context: string,
): { costUsd: number | undefined; durationMs: number | undefined } {
  let validCostUsd = costUsd;
  let validDurationMs = durationMs;

  if (costUsd !== undefined && costUsd < 0) {
    console.warn(`[cli-provider] ${context}: ignoring negative cost_usd value (${costUsd})`);
    validCostUsd = undefined;
  }

  if (durationMs !== undefined && durationMs < 0) {
    console.warn(`[cli-provider] ${context}: ignoring negative duration_ms value (${durationMs})`);
    validDurationMs = undefined;
  }

  return { costUsd: validCostUsd, durationMs: validDurationMs };
}

/**
 * Converts Zod-parsed output messages to internal Message format.
 * Handles snake_case to camelCase conversion for toolCalls and durationMs.
 */
function convertMessages(
  messages: readonly ParsedMessage[] | undefined,
): readonly Message[] | undefined {
  if (!messages || messages.length === 0) {
    return undefined;
  }

  return messages.map((msg) => ({
    role: msg.role,
    name: msg.name,
    content: msg.content,
    toolCalls: msg.tool_calls?.map((tc) => ({
      tool: tc.tool,
      input: tc.input,
      output: tc.output,
      id: tc.id,
      startTime: tc.start_time,
      endTime: tc.end_time,
      durationMs: tc.duration_ms,
    })),
    startTime: msg.start_time,
    endTime: msg.end_time,
    durationMs: msg.duration_ms,
    metadata: msg.metadata,
  }));
}

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

    // Use request.cwd (workspace override) if provided, otherwise fall back to config.cwd
    const effectiveCwd = request.cwd ?? this.config.cwd;

    const outputFilePath = generateOutputFilePath(request.evalCaseId);
    const templateValues = buildTemplateValues(request, this.config, outputFilePath);
    const renderedCommand = renderTemplate(this.config.commandTemplate, templateValues);

    if (this.verbose) {
      console.log(
        `[cli-provider:${this.targetName}] cwd=${effectiveCwd ?? ''} command=${renderedCommand}`,
      );
    }

    // Measure wall-clock time as fallback for duration
    const startTime = Date.now();
    const result = await this.runCommand(renderedCommand, {
      cwd: effectiveCwd,
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
      output: parsed.output,
      tokenUsage: parsed.tokenUsage,
      costUsd: parsed.costUsd,
      durationMs: parsed.durationMs ?? measuredDurationMs,
      raw: {
        command: renderedCommand,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0,
        cwd: effectiveCwd,
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

    // Calculate per-request fallback duration (total time / number of requests)
    const perRequestFallbackMs = Math.round(measuredDurationMs / requests.length);

    const responses: ProviderResponse[] = requests.map((request) => {
      const evalCaseId = request.evalCaseId;
      if (!evalCaseId) {
        return {
          output: [],
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
        // Return error response for missing IDs instead of throwing.
        // This allows other eval cases with matching IDs to be evaluated correctly.
        const errorMessage = `Batch output missing id '${evalCaseId}'`;
        if (this.verbose) {
          console.warn(`[cli-provider:${this.targetName}] ${errorMessage}`);
        }
        return {
          output: [{ role: 'assistant', content: `Error: ${errorMessage}` }],
          durationMs: perRequestFallbackMs,
          raw: {
            command: renderedCommand,
            stderr: result.stderr,
            exitCode: result.exitCode ?? 0,
            cwd: this.config.cwd,
            outputFile: outputFilePath,
            error: errorMessage,
          },
        };
      }

      return {
        output: parsed.output,
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
   * If only 'text' is provided, wrap it in output.
   * Otherwise, treat the entire content as plain text wrapped in output.
   *
   * Also extracts optional execution metrics:
   * - token_usage: { input, output, cached? }
   * - cost_usd: number
   * - duration_ms: number
   */
  private parseOutputContent(content: string): {
    output: readonly Message[];
    tokenUsage?: ProviderTokenUsage;
    costUsd?: number;
    durationMs?: number;
  } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Not valid JSON, treat as plain text
      return { output: [{ role: 'assistant', content }] };
    }

    // Validate against schema
    const result = CliOutputSchema.safeParse(parsed);
    if (!result.success) {
      // Invalid structure, treat as plain text
      return { output: [{ role: 'assistant', content }] };
    }

    const obj = result.data;

    // Validate metrics and warn about negative values
    const metrics = validateMetrics(obj.cost_usd, obj.duration_ms, 'parsing output');

    // Convert output_messages to Message[] format
    const output = convertMessages(obj.output_messages);

    // If output_messages provided, use it
    if (output && output.length > 0) {
      return {
        output,
        tokenUsage: obj.token_usage,
        costUsd: metrics.costUsd,
        durationMs: metrics.durationMs,
      };
    }

    // Fall back to text field, wrap in output
    if (obj.text !== undefined) {
      const text = typeof obj.text === 'string' ? obj.text : String(obj.text);
      return {
        output: [{ role: 'assistant', content: text }],
        tokenUsage: obj.token_usage,
        costUsd: metrics.costUsd,
        durationMs: metrics.durationMs,
      };
    }

    // No output_messages or text, treat original content as plain text
    return { output: [{ role: 'assistant', content }] };
  }

  private parseJsonlBatchOutput(content: string): Map<
    string,
    {
      output: readonly Message[];
      tokenUsage?: ProviderTokenUsage;
      costUsd?: number;
      durationMs?: number;
    }
  > {
    const records = new Map<
      string,
      {
        output: readonly Message[];
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
        parsed = JSON.parse(line);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`CLI batch output contains invalid JSONL line: ${reason}`);
      }

      // Validate against schema
      const result = CliJsonlRecordSchema.safeParse(parsed);
      if (!result.success) {
        const firstError = result.error.errors[0];
        if (firstError?.path.includes('id')) {
          throw new Error('CLI batch output JSONL line missing required string field: id');
        }
        throw new Error('CLI batch output JSONL line must be an object');
      }

      const obj = result.data;

      if (records.has(obj.id)) {
        throw new Error(`CLI batch output contains duplicate id: ${obj.id}`);
      }

      // Prefer output_messages, fall back to text wrapped in output
      const output = convertMessages(obj.output_messages);
      let finalMessages: readonly Message[];
      if (output && output.length > 0) {
        finalMessages = output;
      } else {
        // Fall back to text field
        const text =
          typeof obj.text === 'string'
            ? obj.text
            : obj.text === undefined
              ? ''
              : JSON.stringify(obj.text);
        finalMessages = text ? [{ role: 'assistant', content: text }] : [];
      }

      // Validate metrics and warn about negative values
      const metrics = validateMetrics(obj.cost_usd, obj.duration_ms, `batch record '${obj.id}'`);

      records.set(obj.id, {
        output: finalMessages,
        tokenUsage: obj.token_usage,
        costUsd: metrics.costUsd,
        durationMs: metrics.durationMs,
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
