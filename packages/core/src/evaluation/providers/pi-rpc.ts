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
  splitPiCommand,
} from './pi-process.js';
import {
  extractAzureResourceName,
  resolveCliProvider,
  resolveEnvKeyName,
} from './pi-provider-aliases.js';
import { extractPiTextContent, toFiniteNumber } from './pi-utils.js';
import { normalizeInputFiles } from './preread.js';
import { deriveSkillCallMetadataFromMessages } from './skill-calls.js';
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
    const command = this.buildCommand();
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
      env: this.buildEnv(),
      signal: request.signal,
      stdin: `${JSON.stringify(rpcRequest)}\n`,
      stdinEnd: 'manual',
      completeOnStdout: (stdout) => hasRpcAgentEnd(stdout, rpcRequest.id),
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

    const resultError = rpcResultError(parsed.result);
    if (resultError) {
      return this.buildRpcTaskFailureResponse({
        result,
        command,
        cwd,
        startedAt,
        message: resultError,
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
      metadata: deriveSkillCallMetadataFromMessages(output),
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

  private buildCommand(): readonly string[] {
    const args: string[] = [];
    if (this.config.subprovider) {
      args.push('--provider', resolveCliProvider(this.config.subprovider));
    }
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.apiKey && this.config.subprovider?.toLowerCase() !== 'azure') {
      args.push('--api-key', this.config.apiKey);
    }
    if (this.config.systemPrompt) {
      args.push('--system-prompt', this.config.systemPrompt);
    }

    if (!hasModeFlag(this.config.command)) {
      args.push('--mode', 'rpc');
    }
    args.push('--no-session');

    if (this.config.tools) {
      args.push('--tools', this.config.tools);
    }
    if (this.config.thinking) {
      args.push('--thinking', this.config.thinking);
    }

    return splitPiCommand(this.config.command, args);
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = buildPiRuntimeEnv({
      runtime: this.config.runtime,
      targetName: this.targetName,
    });

    const provider = this.config.subprovider?.toLowerCase() ?? 'google';
    if (provider === 'azure') {
      if (this.config.apiKey) {
        env.AZURE_OPENAI_API_KEY = this.config.apiKey;
      }
      if (this.config.baseUrl) {
        if (/^https?:\/\//.test(this.config.baseUrl)) {
          env.AZURE_OPENAI_BASE_URL = this.config.baseUrl;
        } else {
          env.AZURE_OPENAI_RESOURCE_NAME = extractAzureResourceName(this.config.baseUrl);
        }
      }
    } else if (this.config.apiKey) {
      const envKey = resolveEnvKeyName(provider);
      if (envKey) {
        env[envKey] = this.config.apiKey;
      }
    }

    if (this.config.subprovider) {
      const resolvedProvider = resolveCliProvider(this.config.subprovider);
      const providerOwnPrefixes: Record<string, readonly string[]> = {
        openrouter: ['OPENROUTER_'],
        anthropic: ['ANTHROPIC_'],
        openai: ['OPENAI_'],
        'azure-openai-responses': ['AZURE_OPENAI_'],
        google: ['GEMINI_', 'GOOGLE_GENERATIVE_AI_'],
        gemini: ['GEMINI_', 'GOOGLE_GENERATIVE_AI_'],
        groq: ['GROQ_'],
        xai: ['XAI_'],
      };
      const ownPrefixes = providerOwnPrefixes[resolvedProvider] ?? [];
      const allOtherPrefixes = Object.entries(providerOwnPrefixes)
        .filter(([key]) => key !== resolvedProvider)
        .flatMap(([, prefixes]) => prefixes);
      for (const key of Object.keys(env)) {
        if (
          allOtherPrefixes.some((prefix) => key.startsWith(prefix)) &&
          !ownPrefixes.some((prefix) => key.startsWith(prefix))
        ) {
          delete env[key];
        }
      }
    }

    return env;
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
  readonly id: string;
  readonly type: 'prompt';
  readonly message: string;
  readonly streamingBehavior?: 'followUp';
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
  const prefix = params.request.systemPrompt ? `${params.request.systemPrompt}\n\n` : '';
  const suffix =
    params.inputFiles && params.inputFiles.length > 0
      ? `\n\nInput files:\n${params.inputFiles.map((file) => `@${file}`).join('\n')}`
      : '';
  return {
    id: randomUUID(),
    type: 'prompt',
    message: `${prefix}${params.request.question}${suffix}`,
  };
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

    if (message.id === requestId && message.type === 'response') {
      if (message.success === false) {
        error = rpcErrorMessage(message.error ?? message.message);
      }
      continue;
    }
    if (message.type === 'agent_end') {
      result = message;
      events.push(message);
      continue;
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

function hasRpcAgentEnd(stdout: string, requestId: string): boolean {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.type === 'agent_end') {
        return true;
      }
      if (parsed.id === requestId && parsed.type === 'response' && parsed.success === false) {
        return true;
      }
    } catch {
      // Keep waiting; parseRpcOutput will report malformed lines after exit.
    }
  }
  return false;
}

function hasModeFlag(command: readonly string[]): boolean {
  return command.some(
    (arg, index) =>
      arg === '--mode' || arg.startsWith('--mode=') || command[index - 1] === '--mode',
  );
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

function rpcResultError(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  if (!Array.isArray(record.messages)) {
    return undefined;
  }
  const errored = [...record.messages].reverse().find((message) => {
    if (!message || typeof message !== 'object') return false;
    const msg = message as Record<string, unknown>;
    return msg.role === 'assistant' && (msg.stopReason === 'error' || msg.stop_reason === 'error');
  });
  if (!errored || typeof errored !== 'object') {
    return undefined;
  }
  const msg = errored as Record<string, unknown>;
  return (
    stringField(msg, 'errorMessage') ??
    stringField(msg, 'error_message') ??
    'Pi RPC assistant message ended with stopReason=error'
  );
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
    return tokenUsageFromMessages(record.messages);
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

function tokenUsageFromMessages(messages: unknown): ProviderTokenUsage | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalCached = 0;
  let totalReasoning = 0;
  let found = false;

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    const usage = (message as Record<string, unknown>).usage;
    if (!usage || typeof usage !== 'object') {
      continue;
    }
    found = true;
    const record = usage as Record<string, unknown>;
    totalInput += toFiniteNumber(record.input) ?? 0;
    totalOutput += toFiniteNumber(record.output) ?? 0;
    totalCached +=
      toFiniteNumber(record.cacheRead) ??
      toFiniteNumber(record.cache_read) ??
      toFiniteNumber(record.cached) ??
      0;
    totalReasoning +=
      toFiniteNumber(record.reasoning) ?? toFiniteNumber(record.reasoning_tokens) ?? 0;
  }

  if (!found) {
    return undefined;
  }
  return {
    input: totalInput,
    output: totalOutput,
    ...(totalCached > 0 ? { cached: totalCached } : {}),
    ...(totalReasoning > 0 ? { reasoning: totalReasoning } : {}),
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
  hasModeFlag,
  hasRpcAgentEnd,
  parseRpcOutput,
};
