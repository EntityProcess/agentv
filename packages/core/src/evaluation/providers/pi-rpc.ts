import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  type PiProcessRunResult,
  type PiProcessRunner,
  buildPiRuntimeEnv,
  buildPiTargetExecution,
  classifyPiProcessFailure,
  defaultPiProcessRunner,
  piProcessFailureMessage,
} from './pi-process.js';
import { extractPiTextContent, toFiniteNumber } from './pi-utils.js';
import { normalizeInputFiles } from './preread.js';
import type { PiRpcResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
} from './types.js';
import { extractLastAssistantContent } from './types.js';

export class PiRpcProvider implements Provider {
  readonly id: string;
  readonly kind = 'pi-rpc' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: PiRpcResolvedConfig;
  private readonly runPi: PiProcessRunner;

  constructor(
    targetName: string,
    config: PiRpcResolvedConfig,
    runner: PiProcessRunner = defaultPiProcessRunner,
  ) {
    this.id = `pi-rpc:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runPi = runner;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Pi RPC request was aborted before execution');
    }

    const startedAt = Date.now();
    const cwd = this.resolveCwd(request.cwd);
    const command = ensureRpcMode(this.config.command);
    const inputFiles = normalizeInputFiles(request.inputFiles);
    const rpcRequest = buildRpcRequest({
      request,
      config: this.config,
      inputFiles,
    });

    const result = await this.runPi({
      command,
      cwd,
      timeoutMs: this.config.timeoutMs,
      env: buildPiRuntimeEnv({ runtime: this.config.runtime, targetName: this.targetName }),
      signal: request.signal,
      stdin: `${JSON.stringify(rpcRequest)}\n`,
    });

    if (result.timedOut || result.exitCode !== 0 || result.signal || result.spawnErrorCode) {
      return this.buildProcessErrorResponse({
        result,
        command,
        cwd,
        startedAt,
        signalAborted: request.signal?.aborted,
      });
    }

    let parsed: ParsedRpcOutput;
    try {
      parsed = parseRpcOutput(result.stdout, rpcRequest.id);
    } catch (error) {
      return this.buildProtocolErrorResponse({
        result,
        command,
        cwd,
        startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (parsed.error) {
      return this.buildRpcTaskFailureResponse({
        result,
        command,
        cwd,
        startedAt,
        message: parsed.error,
        events: parsed.events,
      });
    }

    const output = messagesFromRpcResult(parsed.result);
    const tokenUsage = tokenUsageFromRpcResult(parsed.result);
    const endedAt = Date.now();
    const finalOutput = extractLastAssistantContent(output);

    return {
      raw: {
        response: parsed.result,
        events: parsed.events,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        command,
        cwd,
        inputFiles,
      },
      output,
      tokenUsage,
      durationMs: endedAt - startedAt,
      startTime: new Date(startedAt).toISOString(),
      endTime: new Date(endedAt).toISOString(),
      targetExecution: buildPiTargetExecution({
        targetName: this.targetName,
        providerId: this.id,
        providerKind: this.kind,
        runtimeMode: this.config.runtime.mode,
        command,
        cwd,
        timeoutMs: this.config.timeoutMs,
        startedAt,
        endedAt,
        result,
        status: 'success',
        output,
        finalOutput,
        details: { events: parsed.events, inputFiles },
      }),
    };
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

  private buildProcessErrorResponse(params: {
    readonly result: PiProcessRunResult;
    readonly command: readonly string[];
    readonly cwd: string;
    readonly startedAt: number;
    readonly signalAborted?: boolean;
  }): ProviderResponse {
    const errorKind = classifyPiProcessFailure(params.result, params.signalAborted);
    const message = piProcessFailureMessage({
      providerLabel: 'Pi RPC',
      result: params.result,
      errorKind,
      timeoutMs: this.config.timeoutMs,
    });
    return this.errorResponse({
      ...params,
      errorKind,
      message,
      details: { spawnErrorCode: params.result.spawnErrorCode },
    });
  }

  private buildProtocolErrorResponse(params: {
    readonly result: PiProcessRunResult;
    readonly command: readonly string[];
    readonly cwd: string;
    readonly startedAt: number;
    readonly message: string;
  }): ProviderResponse {
    return this.errorResponse({
      ...params,
      errorKind: 'malformed_output',
      message: `Pi RPC malformed protocol output: ${params.message}`,
    });
  }

  private buildRpcTaskFailureResponse(params: {
    readonly result: PiProcessRunResult;
    readonly command: readonly string[];
    readonly cwd: string;
    readonly startedAt: number;
    readonly message: string;
    readonly events: readonly unknown[];
  }): ProviderResponse {
    return this.errorResponse({
      ...params,
      errorKind: 'target_task_failure',
      message: params.message,
      details: { events: params.events },
    });
  }

  private errorResponse(params: {
    readonly result: PiProcessRunResult;
    readonly command: readonly string[];
    readonly cwd: string;
    readonly startedAt: number;
    readonly errorKind:
      | 'target_task_failure'
      | 'malformed_output'
      | ReturnType<typeof classifyPiProcessFailure>;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  }): ProviderResponse {
    const endedAt = Date.now();
    const output = [{ role: 'assistant' as const, content: `Error: ${params.message}` }];
    return {
      raw: {
        stdout: params.result.stdout,
        stderr: params.result.stderr,
        exitCode: params.result.exitCode,
        signal: params.result.signal,
        command: params.command,
        cwd: params.cwd,
        error: params.message,
      },
      output,
      durationMs: endedAt - params.startedAt,
      startTime: new Date(params.startedAt).toISOString(),
      endTime: new Date(endedAt).toISOString(),
      targetExecution: buildPiTargetExecution({
        targetName: this.targetName,
        providerId: this.id,
        providerKind: this.kind,
        runtimeMode: this.config.runtime.mode,
        command: params.command,
        cwd: params.cwd,
        timeoutMs: this.config.timeoutMs,
        startedAt: params.startedAt,
        endedAt,
        result: params.result,
        status: 'error',
        errorKind: params.errorKind,
        message: params.message,
        output,
        finalOutput: `Error: ${params.message}`,
        details: params.details,
      }),
    };
  }
}

type RpcRequest = {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly method: 'run';
  readonly params: Record<string, unknown>;
};

type ParsedRpcOutput = {
  readonly result?: unknown;
  readonly error?: string;
  readonly events: readonly unknown[];
};

function buildRpcRequest(params: {
  readonly request: ProviderRequest;
  readonly config: PiRpcResolvedConfig;
  readonly inputFiles?: readonly string[];
}): RpcRequest {
  const rpcParams: Record<string, unknown> = {
    prompt: params.request.question,
    system_prompt: params.config.systemPrompt ?? params.request.systemPrompt,
    model: params.config.model,
    subprovider: params.config.subprovider,
    tools: params.config.tools,
    thinking: params.config.thinking,
    input_files: params.inputFiles,
    metadata: params.request.metadata,
  };
  for (const key of Object.keys(rpcParams)) {
    if (rpcParams[key] === undefined) {
      delete rpcParams[key];
    }
  }
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'run',
    params: rpcParams,
  };
}

function ensureRpcMode(command: readonly string[]): readonly string[] {
  const hasMode = command.some(
    (arg, index) =>
      arg === '--mode' || arg.startsWith('--mode=') || command[index - 1] === '--mode',
  );
  return hasMode ? command : [...command, '--mode', 'rpc'];
}

function parseRpcOutput(stdout: string, requestId: string): ParsedRpcOutput {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error('Pi RPC produced no protocol messages');
  }

  const events: unknown[] = [];
  let result: unknown;
  let error: string | undefined;

  for (const line of lines) {
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('message is not an object');
      }
      message = parsed as Record<string, unknown>;
    } catch (parseError) {
      throw new Error(`invalid JSON protocol message: ${formatError(parseError)}`);
    }

    if (message.id === requestId && Object.prototype.hasOwnProperty.call(message, 'result')) {
      result = message.result;
      continue;
    }
    if (message.id === requestId && Object.prototype.hasOwnProperty.call(message, 'error')) {
      error = rpcErrorMessage(message.error);
      continue;
    }
    if (message.type === 'result') {
      result = message.result ?? message.response ?? message;
      continue;
    }
    if (message.type === 'error') {
      error = rpcErrorMessage(message.error ?? message.message);
      continue;
    }
    events.push(message);
  }

  if (error) {
    return { error, events };
  }
  if (result === undefined) {
    throw new Error('Pi RPC disconnected before a result message');
  }
  return { result, events };
}

function messagesFromRpcResult(result: unknown): readonly Message[] {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.output)) {
      return record.output.map(convertRpcMessage).filter((msg): msg is Message => Boolean(msg));
    }
    if (Array.isArray(record.messages)) {
      return record.messages.map(convertRpcMessage).filter((msg): msg is Message => Boolean(msg));
    }
    const content = record.text ?? record.output_text ?? record.content;
    if (typeof content === 'string') {
      return [{ role: 'assistant', content }];
    }
  }
  if (typeof result === 'string') {
    return [{ role: 'assistant', content: result }];
  }
  return [{ role: 'assistant', content: JSON.stringify(result) }];
}

function convertRpcMessage(value: unknown): Message | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const role = typeof record.role === 'string' ? record.role : undefined;
  if (!role) {
    return undefined;
  }
  const content = extractPiTextContent(record.content) ?? stringField(record, 'text');
  return {
    role,
    content,
    metadata:
      record.metadata && typeof record.metadata === 'object'
        ? (record.metadata as Record<string, unknown>)
        : undefined,
  };
}

function tokenUsageFromRpcResult(result: unknown): ProviderTokenUsage | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  const usage = (record.token_usage ?? record.tokenUsage ?? record.usage) as
    | Record<string, unknown>
    | undefined;
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }
  const input = toFiniteNumber(usage.input ?? usage.input_tokens ?? usage.inputTokens);
  const output = toFiniteNumber(usage.output ?? usage.output_tokens ?? usage.outputTokens);
  if (input === undefined && output === undefined) {
    return undefined;
  }
  const cached = toFiniteNumber(usage.cached ?? usage.cache_read_input_tokens);
  const reasoning = toFiniteNumber(usage.reasoning ?? usage.reasoning_tokens);
  return {
    input: input ?? 0,
    output: output ?? 0,
    ...(cached !== undefined ? { cached } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function rpcErrorMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string') {
      return record.message;
    }
  }
  return JSON.stringify(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const _internal = {
  ensureRpcMode,
  parseRpcOutput,
};
