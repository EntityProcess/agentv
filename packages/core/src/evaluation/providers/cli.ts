import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import type { Content } from '../content.js';
import { isContentArray } from '../content.js';
import { readTextFile } from '../file-utils.js';
import {
  type SandboxCommandRunOptions,
  type TargetRuntimeConfig,
  runDockerSandboxCommand,
} from './sandbox-runner.js';
import { buildTargetExecutionEnvelope, captureTargetExecutionLog } from './target-execution.js';
import type { CliResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  TargetExecutionEnvelope,
  TargetExecutionErrorKind,
} from './types.js';
import { extractLastAssistantContent } from './types.js';

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
  status: z.enum(['ok', 'error', 'timeout', 'cancelled', 'unknown']).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  duration_ms: z.number().optional(),
});

/**
 * Schema for individual output messages.
 * Validates output array items from CLI JSON output.
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
  error: z.string().optional(),
  output: z.array(MessageInputSchema).optional(),
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
    content: isContentArray(msg.content)
      ? (msg.content as Content[])
      : typeof msg.content === 'string'
        ? msg.content
        : undefined,
    toolCalls: msg.tool_calls?.map((tc) => ({
      tool: tc.tool,
      input: tc.input,
      output: tc.output,
      id: tc.id,
      status: tc.status,
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
  readonly spawnErrorCode?: string;
  readonly sandboxInfraFailure?: boolean;
  readonly sandboxDetails?: Record<string, unknown>;
}

export type CommandRunner = (
  command: string,
  options: CommandRunOptions,
) => Promise<CommandRunResult>;

export type SandboxCommandRunner = (
  command: string,
  options: SandboxCommandRunOptions,
) => Promise<CommandRunResult>;

async function defaultCommandRunner(
  command: string,
  options: CommandRunOptions,
): Promise<CommandRunResult> {
  return new Promise((resolve) => {
    const useWindowsShell = process.platform === 'win32';
    const shell = useWindowsShell ? 'powershell.exe' : '/bin/sh';
    const args = useWindowsShell ? ['-NoProfile', '-Command', command] : ['-lc', command];
    const child = spawn(shell, args, {
      cwd: options.cwd,
      env: options.env,
      detached: !useWindowsShell,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const append = (current: string, chunk: Buffer) => {
      if (Buffer.byteLength(current, 'utf8') >= DEFAULT_MAX_BUFFER) {
        return current;
      }
      return `${current}${chunk.toString('utf8')}`;
    };

    const terminate = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) {
        return;
      }
      try {
        if (useWindowsShell) {
          child.kill(signal);
        } else {
          process.kill(-child.pid, signal);
        }
      } catch {
        child.kill(signal);
      }
    };

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          terminate('SIGTERM');
          setTimeout(() => terminate('SIGKILL'), 2_000).unref?.();
        }, options.timeoutMs)
      : undefined;
    timeout?.unref?.();

    const abort = () => {
      cancelled = true;
      terminate('SIGTERM');
      setTimeout(() => terminate('SIGKILL'), 2_000).unref?.();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        abort();
      } else {
        options.signal.addEventListener('abort', abort, { once: true });
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener('abort', abort);
      resolve({
        stdout,
        stderr: stderr || error.message,
        exitCode: null,
        failed: true,
        timedOut,
        signal: null,
        spawnErrorCode: error.code,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener('abort', abort);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        failed: code !== 0 || signal !== null || timedOut || cancelled,
        timedOut,
        signal,
      });
    });
  });
}

function commandEnvelopeBase(params: {
  targetName: string;
  providerId: string;
  providerKind: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  startedAt: number;
  endedAt: number;
  runtimeMode?: string;
  result?: CommandRunResult;
}): Omit<TargetExecutionEnvelope, 'status'> {
  const argv =
    process.platform === 'win32'
      ? ['powershell.exe', '-NoProfile', '-Command', params.command]
      : ['/bin/sh', '-lc', params.command];
  return buildTargetExecutionEnvelope({
    targetName: params.targetName,
    providerId: params.providerId,
    providerKind: params.providerKind,
    status: 'success',
    runtimeMode: params.runtimeMode ?? 'host',
    commandArgv: argv,
    commandLine: params.command,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    exitCode: params.result?.exitCode,
    signal: params.result?.signal ?? null,
    stdout: params.result?.stdout ?? '',
    stderr: params.result?.stderr ?? '',
  });
}

function classifyCommandFailure(
  result: CommandRunResult,
  signalAborted: boolean | undefined,
): TargetExecutionErrorKind {
  if (signalAborted) {
    return 'cancelled';
  }
  if (result.timedOut) {
    return 'timeout';
  }
  if (result.sandboxInfraFailure) {
    return 'sandbox_infra_failure';
  }
  if (result.spawnErrorCode) {
    return 'spawn_failure';
  }
  if (result.signal && result.exitCode === null) {
    return 'signal_crash';
  }
  return 'nonzero_exit';
}

function commandFailureMessage(result: CommandRunResult, errorKind: TargetExecutionErrorKind) {
  if (errorKind === 'cancelled') {
    return 'CLI provider request was aborted';
  }
  if (errorKind === 'timeout') {
    return 'CLI provider timed out';
  }
  if (errorKind === 'sandbox_infra_failure') {
    return result.stderr.trim() || result.stdout.trim() || 'Sandbox runtime failed';
  }
  if (errorKind === 'spawn_failure') {
    return (
      result.stderr.trim() ||
      result.stdout.trim() ||
      `CLI failed to spawn (${result.spawnErrorCode})`
    );
  }
  if (errorKind === 'signal_crash') {
    return `CLI terminated by signal ${result.signal ?? 'unknown'}`;
  }
  const codeText = result.exitCode !== null ? result.exitCode : 'unknown';
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail ? `${detail} (exit code ${codeText})` : `CLI exited with code ${codeText}`;
}

export class CliProvider implements Provider {
  readonly id: string;
  readonly kind = 'cli';
  readonly targetName: string;
  readonly supportsBatch = true;

  private readonly config: CliResolvedConfig;
  private readonly runCommand: CommandRunner;
  private readonly runSandboxCommand: SandboxCommandRunner;
  private readonly runtime?: TargetRuntimeConfig;
  private readonly verbose: boolean;
  private readonly keepTempFiles: boolean;
  private healthcheckPromise?: Promise<void>;

  constructor(
    targetName: string,
    config: CliResolvedConfig,
    runner: CommandRunner = defaultCommandRunner,
    runtime?: TargetRuntimeConfig,
    sandboxRunner: SandboxCommandRunner = runDockerSandboxCommand,
  ) {
    this.targetName = targetName;
    this.id = `cli:${targetName}`;
    this.config = config;
    this.runCommand = runner;
    this.runSandboxCommand = sandboxRunner;
    this.runtime = runtime;
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
    const { values: templateValues, promptFilePath } = await buildTemplateValues(
      request,
      this.config,
      outputFilePath,
    );
    const renderedCommand = renderTemplate(this.config.command, templateValues);

    if (this.verbose) {
      console.log(
        `[cli-provider:${this.targetName}] cwd=${effectiveCwd ?? ''} command=${renderedCommand}`,
      );
    }

    // Measure wall-clock time as fallback for duration
    try {
      const startTime = Date.now();
      const result = await this.runCommandForRuntime(renderedCommand, {
        cwd: effectiveCwd,
        env: process.env,
        timeoutMs: this.config.timeoutMs,
        signal: request.signal,
      });
      const measuredDurationMs = Date.now() - startTime;

      if (result.failed || (result.exitCode ?? 0) !== 0) {
        const errorKind = classifyCommandFailure(result, request.signal?.aborted);
        const baseMessage = commandFailureMessage(result, errorKind);
        const message =
          errorKind === 'timeout'
            ? `${baseMessage}${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`
            : baseMessage;
        return {
          output: [{ role: 'assistant', content: `Error: ${message}` }],
          durationMs: measuredDurationMs,
          targetExecution: {
            ...commandEnvelopeBase({
              targetName: this.targetName,
              providerId: this.id,
              providerKind: this.kind,
              command: renderedCommand,
              cwd: effectiveCwd,
              timeoutMs: this.config.timeoutMs,
              startedAt: startTime,
              endedAt: Date.now(),
              runtimeMode: this.runtimeMode(),
              result,
            }),
            status: 'error',
            errorKind,
            message,
            transcript: {
              messages: [{ role: 'assistant', content: `Error: ${message}` }],
              finalOutput: `Error: ${message}`,
            },
            details: {
              outputFile: outputFilePath,
              spawnErrorCode: result.spawnErrorCode,
              sandbox: result.sandboxDetails,
            },
          },
          raw: {
            command: renderedCommand,
            stderr: result.stderr,
            stdout: result.stdout,
            exitCode: result.exitCode,
            signal: result.signal,
            cwd: effectiveCwd,
            outputFile: outputFilePath,
            error: message,
          },
        };
      }

      // Read from output file and parse as JSON if possible
      let responseContent: string;
      try {
        responseContent = await this.readAndCleanupOutputFile(outputFilePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          output: [{ role: 'assistant', content: `Error: ${message}` }],
          durationMs: measuredDurationMs,
          targetExecution: {
            ...commandEnvelopeBase({
              targetName: this.targetName,
              providerId: this.id,
              providerKind: this.kind,
              command: renderedCommand,
              cwd: effectiveCwd,
              timeoutMs: this.config.timeoutMs,
              startedAt: startTime,
              endedAt: Date.now(),
              runtimeMode: this.runtimeMode(),
              result,
            }),
            status: 'error',
            errorKind: 'malformed_output',
            message,
            transcript: {
              messages: [{ role: 'assistant', content: `Error: ${message}` }],
              finalOutput: `Error: ${message}`,
            },
            details: { outputFile: outputFilePath },
          },
          raw: {
            command: renderedCommand,
            stderr: result.stderr,
            stdout: result.stdout,
            exitCode: result.exitCode ?? 0,
            cwd: effectiveCwd,
            outputFile: outputFilePath,
            error: message,
          },
        };
      }
      const parsed = this.parseOutputContent(responseContent);
      const finalOutput = extractLastAssistantContent(parsed.output);
      const targetTaskFailure = parsed.error?.trim();

      return {
        output: parsed.output,
        tokenUsage: parsed.tokenUsage,
        costUsd: parsed.costUsd,
        durationMs: parsed.durationMs ?? measuredDurationMs,
        targetExecution: {
          ...commandEnvelopeBase({
            targetName: this.targetName,
            providerId: this.id,
            providerKind: this.kind,
            command: renderedCommand,
            cwd: effectiveCwd,
            timeoutMs: this.config.timeoutMs,
            startedAt: startTime,
            endedAt: Date.now(),
            runtimeMode: this.runtimeMode(),
            result,
          }),
          status: targetTaskFailure ? 'error' : 'success',
          errorKind: targetTaskFailure ? 'target_task_failure' : undefined,
          message: targetTaskFailure,
          transcript: {
            messages: parsed.output,
            finalOutput,
          },
          details: { outputFile: outputFilePath },
        },
        raw: {
          command: renderedCommand,
          stderr: result.stderr,
          stdout: result.stdout,
          exitCode: result.exitCode ?? 0,
          cwd: effectiveCwd,
          outputFile: outputFilePath,
        },
      };
    } finally {
      await cleanupTempFile(promptFilePath, this.keepTempFiles);
    }
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

    const { values: templateValues, promptFilePath } = await buildTemplateValues(
      {
        question: '',
        inputFiles: batchInputFiles,
        evalCaseId: 'batch',
        attempt: 0,
      },
      this.config,
      outputFilePath,
    );
    const renderedCommand = renderTemplate(this.config.command, templateValues);

    // Use per-request cwd override (from workspace) if any request provides one,
    // otherwise fall back to the target's configured cwd.
    // All requests in a batch share the same workspace, so the first request's cwd
    // is representative of the entire batch.
    const effectiveCwd = requests[0]?.cwd ?? this.config.cwd;

    if (this.verbose) {
      console.log(
        `[cli-provider:${this.targetName}] (batch size=${requests.length}) cwd=${effectiveCwd ?? ''} command=${renderedCommand}`,
      );
    }

    // Measure wall-clock time for batch (used as fallback if records don't provide duration)
    try {
      const startTime = Date.now();
      const result = await this.runCommandForRuntime(renderedCommand, {
        cwd: effectiveCwd,
        env: process.env,
        timeoutMs: this.config.timeoutMs,
        signal: controller.signal,
      });
      const measuredDurationMs = Date.now() - startTime;

      if (result.failed || (result.exitCode ?? 0) !== 0) {
        const errorKind = classifyCommandFailure(result, controller.signal.aborted);
        const baseMessage = commandFailureMessage(result, errorKind);
        const message =
          errorKind === 'timeout'
            ? `${baseMessage}${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`
            : baseMessage;
        return requests.map((request) =>
          this.buildBatchErrorResponse({
            request,
            renderedCommand,
            effectiveCwd,
            outputFilePath,
            result,
            startedAt: startTime,
            durationMs: measuredDurationMs,
            perRequestFallbackMs: Math.round(measuredDurationMs / requests.length),
            errorKind,
            message,
          }),
        );
      }

      let responseContent: string;
      try {
        responseContent = await this.readAndCleanupOutputFile(outputFilePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return requests.map((request) =>
          this.buildBatchErrorResponse({
            request,
            renderedCommand,
            effectiveCwd,
            outputFilePath,
            result,
            startedAt: startTime,
            durationMs: measuredDurationMs,
            perRequestFallbackMs: Math.round(measuredDurationMs / requests.length),
            errorKind: 'malformed_output',
            message,
          }),
        );
      }
      let recordsById: Map<
        string,
        {
          output: readonly Message[];
          error?: string;
          tokenUsage?: ProviderTokenUsage;
          costUsd?: number;
          durationMs?: number;
        }
      >;
      try {
        recordsById = this.parseJsonlBatchOutput(responseContent);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return requests.map((request) =>
          this.buildBatchErrorResponse({
            request,
            renderedCommand,
            effectiveCwd,
            outputFilePath,
            result,
            startedAt: startTime,
            durationMs: measuredDurationMs,
            perRequestFallbackMs: Math.round(measuredDurationMs / requests.length),
            errorKind: 'malformed_output',
            message,
          }),
        );
      }

      // Calculate per-request fallback duration (total time / number of requests)
      const perRequestFallbackMs = Math.round(measuredDurationMs / requests.length);

      const responses: ProviderResponse[] = requests.map((request) => {
        const evalCaseId = request.evalCaseId;
        if (!evalCaseId) {
          return {
            output: [],
            durationMs: perRequestFallbackMs,
            targetExecution: {
              ...commandEnvelopeBase({
                targetName: this.targetName,
                providerId: this.id,
                providerKind: this.kind,
                command: renderedCommand,
                cwd: effectiveCwd,
                timeoutMs: this.config.timeoutMs,
                startedAt: startTime,
                endedAt: Date.now(),
                runtimeMode: this.runtimeMode(),
                result,
              }),
              status: 'success',
              transcript: {
                messages: [],
                finalOutput: '',
              },
              details: { outputFile: outputFilePath },
            },
            raw: {
              command: renderedCommand,
              stderr: result.stderr,
              stdout: result.stdout,
              exitCode: result.exitCode ?? 0,
              cwd: effectiveCwd,
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
            targetExecution: {
              ...commandEnvelopeBase({
                targetName: this.targetName,
                providerId: this.id,
                providerKind: this.kind,
                command: renderedCommand,
                cwd: effectiveCwd,
                timeoutMs: this.config.timeoutMs,
                startedAt: startTime,
                endedAt: Date.now(),
                runtimeMode: this.runtimeMode(),
                result,
              }),
              status: 'error',
              errorKind: 'malformed_output',
              message: errorMessage,
              transcript: {
                messages: [{ role: 'assistant', content: `Error: ${errorMessage}` }],
                finalOutput: `Error: ${errorMessage}`,
              },
              details: { outputFile: outputFilePath, recordId: evalCaseId },
            },
            raw: {
              command: renderedCommand,
              stderr: result.stderr,
              stdout: result.stdout,
              exitCode: result.exitCode ?? 0,
              cwd: effectiveCwd,
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
          targetExecution: {
            ...commandEnvelopeBase({
              targetName: this.targetName,
              providerId: this.id,
              providerKind: this.kind,
              command: renderedCommand,
              cwd: effectiveCwd,
              timeoutMs: this.config.timeoutMs,
              startedAt: startTime,
              endedAt: Date.now(),
              runtimeMode: this.runtimeMode(),
              result,
            }),
            status: parsed.error ? 'error' : 'success',
            errorKind: parsed.error ? 'target_task_failure' : undefined,
            message: parsed.error,
            transcript: {
              messages: parsed.output,
              finalOutput: extractLastAssistantContent(parsed.output),
            },
            details: { outputFile: outputFilePath, recordId: evalCaseId },
          },
          raw: {
            command: renderedCommand,
            stderr: result.stderr,
            stdout: result.stdout,
            exitCode: result.exitCode ?? 0,
            cwd: effectiveCwd,
            outputFile: outputFilePath,
            recordId: evalCaseId,
          },
        };
      });

      return responses;
    } finally {
      await cleanupTempFile(promptFilePath, this.keepTempFiles);
    }
  }

  /**
   * Parse output content from CLI.
   * If the content is valid JSON with 'output' (or legacy 'output_messages') or 'text' field, extract them.
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
    error?: string;
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

    // Convert output (or legacy output_messages) to Message[] format
    const output = convertMessages(obj.output ?? obj.output_messages);

    // If output provided, use it
    if (output && output.length > 0) {
      return {
        output,
        error: obj.error,
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
        error: obj.error,
        tokenUsage: obj.token_usage,
        costUsd: metrics.costUsd,
        durationMs: metrics.durationMs,
      };
    }

    // No output or text, treat original content as plain text
    return { output: [{ role: 'assistant', content }], error: obj.error };
  }

  private parseJsonlBatchOutput(content: string): Map<
    string,
    {
      output: readonly Message[];
      error?: string;
      tokenUsage?: ProviderTokenUsage;
      costUsd?: number;
      durationMs?: number;
    }
  > {
    const records = new Map<
      string,
      {
        output: readonly Message[];
        error?: string;
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

      // Prefer output (or legacy output_messages), fall back to text wrapped in output
      const output = convertMessages(obj.output ?? obj.output_messages);
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
        error: obj.error,
        tokenUsage: obj.token_usage,
        costUsd: metrics.costUsd,
        durationMs: metrics.durationMs,
      });
    }

    return records;
  }

  private buildBatchErrorResponse(params: {
    readonly request: ProviderRequest;
    readonly renderedCommand: string;
    readonly effectiveCwd?: string;
    readonly outputFilePath: string;
    readonly result: CommandRunResult;
    readonly startedAt: number;
    readonly durationMs: number;
    readonly perRequestFallbackMs: number;
    readonly errorKind: TargetExecutionErrorKind;
    readonly message: string;
  }): ProviderResponse {
    const content = `Error: ${params.message}`;
    return {
      output: [{ role: 'assistant', content }],
      durationMs: params.perRequestFallbackMs,
      targetExecution: {
        ...commandEnvelopeBase({
          targetName: this.targetName,
          providerId: this.id,
          providerKind: this.kind,
          command: params.renderedCommand,
          cwd: params.effectiveCwd,
          timeoutMs: this.config.timeoutMs,
          startedAt: params.startedAt,
          endedAt: params.startedAt + params.durationMs,
          runtimeMode: this.runtimeMode(),
          result: params.result,
        }),
        status: 'error',
        errorKind: params.errorKind,
        message: params.message,
        transcript: {
          messages: [{ role: 'assistant', content }],
          finalOutput: content,
        },
        details: {
          outputFile: params.outputFilePath,
          recordId: params.request.evalCaseId,
          spawnErrorCode: params.result.spawnErrorCode,
          sandbox: params.result.sandboxDetails,
        },
      },
      raw: {
        command: params.renderedCommand,
        stderr: params.result.stderr,
        stdout: params.result.stdout,
        exitCode: params.result.exitCode,
        signal: params.result.signal,
        cwd: params.effectiveCwd,
        outputFile: params.outputFilePath,
        recordId: params.request.evalCaseId,
        error: params.message,
      },
    };
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

    if ('url' in healthcheck && healthcheck.url) {
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

    const hcCommand = 'command' in healthcheck ? healthcheck.command : undefined;
    if (!hcCommand) {
      throw new Error(`CLI healthcheck for '${this.targetName}': 'command' or 'url' is required`);
    }

    const { values: templateValues, promptFilePath } = await buildTemplateValues(
      {
        question: '',
        inputFiles: [],
        evalCaseId: 'healthcheck',
        attempt: 0,
      },
      this.config,
      generateOutputFilePath('healthcheck'),
    );
    const renderedCommand = renderTemplate(hcCommand, templateValues);
    const hcCwd = 'cwd' in healthcheck ? healthcheck.cwd : undefined;
    if (this.verbose) {
      console.log(
        `[cli-provider:${this.targetName}] (healthcheck) cwd=${hcCwd ?? this.config.cwd ?? ''} command=${renderedCommand}`,
      );
    }

    try {
      const result = await this.runCommandForRuntime(renderedCommand, {
        cwd: hcCwd ?? this.config.cwd,
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
    } finally {
      await cleanupTempFile(promptFilePath, this.keepTempFiles);
    }
  }

  private runtimeMode(): string {
    return this.runtime?.mode ?? 'host';
  }

  private async runCommandForRuntime(
    command: string,
    options: CommandRunOptions,
  ): Promise<CommandRunResult> {
    if (this.runtime?.mode !== 'sandbox') {
      return this.runCommand(command, options);
    }
    return this.runSandboxCommand(command, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      runtime: this.runtime,
    });
  }
}

async function buildTemplateValues(
  request: Pick<ProviderRequest, 'question' | 'inputFiles' | 'evalCaseId' | 'attempt'>,
  config: CliResolvedConfig,
  outputFilePath: string,
): Promise<{ values: Record<string, string>; promptFilePath: string }> {
  const inputFiles = normalizeInputFiles(request.inputFiles);
  const promptFilePath = generateOutputFilePath(request.evalCaseId, '.prompt.txt');
  await fs.writeFile(promptFilePath, request.question ?? '', 'utf8');

  return {
    values: {
      PROMPT: shellEscape(request.question ?? ''),
      PROMPT_FILE: shellEscape(promptFilePath),
      EVAL_ID: shellEscape(request.evalCaseId ?? ''),
      ATTEMPT: shellEscape(String(request.attempt ?? 0)),
      FILES: formatFileList(inputFiles, config.filesFormat),
      OUTPUT_FILE: shellEscape(outputFilePath),
    },
    promptFilePath,
  };
}

async function cleanupTempFile(
  filePath: string | undefined,
  keepTempFiles: boolean,
): Promise<void> {
  if (!filePath || keepTempFiles) {
    return;
  }
  await fs.unlink(filePath).catch(() => {
    /* ignore cleanup errors */
  });
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
