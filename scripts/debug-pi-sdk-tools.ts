#!/usr/bin/env bun
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PiCodingAgentProvider } from '../packages/core/src/evaluation/providers/pi-coding-agent.js';
import type {
  Message,
  ProviderStreamCallbacks,
} from '../packages/core/src/evaluation/providers/types.js';

interface Options {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly logDir?: string;
  readonly logFormat: 'summary' | 'json';
  readonly model: string;
  readonly subprovider: string;
  readonly thinking: string;
  readonly timeoutMs: number;
  readonly workspace?: string;
}

interface ToolEvent {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly durationMs?: number;
}

const DEFAULT_MODEL =
  process.env.AGENTV_PI_DEBUG_MODEL ?? process.env.AGENTV_CODEX_MODEL ?? 'gpt-5.3-codex-spark';
const DEFAULT_BASE_URL =
  process.env.AGENTV_PI_DEBUG_BASE_URL ??
  process.env.AGENTV_OPENAI_BASE_URL ??
  process.env.OPENAI_BASE_URL ??
  process.env.OPENAI_ENDPOINT;
const DEFAULT_API_KEY =
  process.env.AGENTV_PI_DEBUG_API_KEY ??
  process.env.AGENTV_OPENAI_API_KEY ??
  process.env.OPENAI_API_KEY ??
  (DEFAULT_BASE_URL ? 'agentv-local-debug-key' : undefined);

function usage(): string {
  return [
    'Usage: bun run debug:pi-sdk-tools [options]',
    '',
    'Runs the PI coding-agent SDK provider directly against a temp workspace with a',
    'tool-heavy prompt. Use this to iterate on PI provider fixes without a full eval.',
    '',
    'Options:',
    '  --model <id>           Model id (default: AGENTV_PI_DEBUG_MODEL, AGENTV_CODEX_MODEL, or gpt-5.3-codex-spark)',
    '  --base-url <url>       OpenAI-compatible base URL (default: AGENTV_PI_DEBUG_BASE_URL, AGENTV_OPENAI_BASE_URL, OPENAI_BASE_URL, or OPENAI_ENDPOINT)',
    '  --api-key <key>        API key (default: AGENTV_PI_DEBUG_API_KEY, AGENTV_OPENAI_API_KEY, OPENAI_API_KEY, or dummy key with base URL)',
    '  --subprovider <name>   PI SDK subprovider (default: openai)',
    '  --thinking <level>     off|minimal|low|medium|high|xhigh (default: low)',
    '  --timeout-ms <ms>      Provider timeout (default: 240000)',
    '  --workspace <path>     Reuse/create a workspace instead of mkdtemp',
    '  --log-dir <path>       Provider stream log directory (default: <workspace>/.agentv-debug/logs)',
    '  --json-log             Write raw JSON event logs instead of summary logs',
    '  --help                 Show this help',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): Options {
  const options: {
    apiKey?: string;
    baseUrl?: string;
    logDir?: string;
    logFormat: 'summary' | 'json';
    model: string;
    subprovider: string;
    thinking: string;
    timeoutMs: number;
    workspace?: string;
  } = {
    apiKey: DEFAULT_API_KEY,
    baseUrl: DEFAULT_BASE_URL,
    logFormat: 'summary',
    model: DEFAULT_MODEL,
    subprovider: process.env.AGENTV_PI_DEBUG_SUBPROVIDER ?? 'openai',
    thinking: process.env.AGENTV_PI_DEBUG_THINKING ?? 'low',
    timeoutMs: Number(process.env.AGENTV_PI_DEBUG_TIMEOUT_MS ?? 240000),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
        return options;
      case '--json-log':
        options.logFormat = 'json';
        break;
      case '--api-key':
        options.apiKey = readRequiredValue(argv, ++i, arg);
        break;
      case '--base-url':
        options.baseUrl = readRequiredValue(argv, ++i, arg);
        break;
      case '--log-dir':
        options.logDir = readRequiredValue(argv, ++i, arg);
        break;
      case '--model':
        options.model = readRequiredValue(argv, ++i, arg);
        break;
      case '--subprovider':
        options.subprovider = readRequiredValue(argv, ++i, arg);
        break;
      case '--thinking':
        options.thinking = readRequiredValue(argv, ++i, arg);
        break;
      case '--timeout-ms': {
        const value = Number(readRequiredValue(argv, ++i, arg));
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid --timeout-ms value: ${argv[i]}`);
        }
        options.timeoutMs = value;
        break;
      }
      case '--workspace':
        options.workspace = readRequiredValue(argv, ++i, arg);
        break;
      default:
        throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`Invalid AGENTV_PI_DEBUG_TIMEOUT_MS value: ${options.timeoutMs}`);
  }

  return options;
}

function readRequiredValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

async function prepareWorkspace(workspace?: string): Promise<string> {
  const root = workspace
    ? path.resolve(workspace)
    : await mkdtemp(path.join(tmpdir(), 'agentv-pi-sdk-tools-'));
  await mkdir(path.join(root, 'data'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });

  await writeFile(
    path.join(root, 'README.md'),
    [
      '# PI SDK Tool Loop Debug Workspace',
      '',
      'This temporary workspace is generated by AgentV to reproduce PI SDK tool-heavy provider runs.',
      'The agent should read files, write a summary, edit it, and run a noisy local command.',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'data', 'input.txt'),
    [
      'alpha: read this line',
      'beta: preserve this line in the generated summary',
      'gamma: run the local noisy command before finishing',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'scripts', 'noisy-output.mjs'),
    [
      'for (let i = 0; i < 400; i += 1) {',
      "  console.log(`debug-line-${i.toString().padStart(3, '0')}`);",
      '}',
    ].join('\n'),
  );

  return root;
}

function countToolCalls(messages: readonly Message[] | undefined): number {
  return messages?.reduce((count, message) => count + (message.toolCalls?.length ?? 0), 0) ?? 0;
}

function summarizeLastAssistant(messages: readonly Message[] | undefined): string {
  const assistant = messages
    ?.slice()
    .reverse()
    .find((message) => message.role === 'assistant' && message.content !== undefined);
  if (!assistant) return '';
  if (typeof assistant.content === 'string') return assistant.content.slice(0, 800);
  return JSON.stringify(assistant.content).slice(0, 800);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const workspace = await prepareWorkspace(options.workspace);
  const logDir = path.resolve(options.logDir ?? path.join(workspace, '.agentv-debug', 'logs'));
  await mkdir(logDir, { recursive: true });

  const toolEvents: ToolEvent[] = [];
  const callbacks: ProviderStreamCallbacks = {
    onToolCallStart(toolName, toolCallId) {
      toolEvents.push({ toolName, toolCallId });
      console.error(`[pi-debug] tool:start ${toolName}${toolCallId ? ` ${toolCallId}` : ''}`);
    },
    onToolCallEnd(toolName, _input, _output, durationMs, toolCallId) {
      toolEvents.push({ toolName, toolCallId, durationMs });
      console.error(
        `[pi-debug] tool:end   ${toolName}${toolCallId ? ` ${toolCallId}` : ''} ${durationMs}ms`,
      );
    },
    onLlmCallEnd(model, tokenUsage) {
      const usage = tokenUsage
        ? ` input=${tokenUsage.input} output=${tokenUsage.output}`
        : ' usage=unknown';
      console.error(`[pi-debug] llm:end    ${model}${usage}`);
    },
  };

  const provider = new PiCodingAgentProvider('debug-pi-sdk-tools', {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    cwd: workspace,
    logDir,
    logFormat: options.logFormat,
    model: options.model,
    streamLog: options.logFormat === 'json' ? 'raw' : 'summary',
    subprovider: options.subprovider,
    thinking: options.thinking,
    timeoutMs: options.timeoutMs,
    tools: 'read,bash,edit,write',
  });

  const startedAt = Date.now();
  console.error(`[pi-debug] workspace: ${workspace}`);
  console.error(`[pi-debug] log dir:   ${logDir}`);
  console.error(`[pi-debug] model:     ${options.subprovider}/${options.model}`);

  const response = await provider.invoke({
    attempt: 0,
    cwd: workspace,
    evalCaseId: 'debug-pi-sdk-tools',
    question: [
      'You are running a short diagnostic of the PI coding-agent tool loop.',
      'Work only in this repository and do not install dependencies.',
      '',
      'Complete these steps in order:',
      '1. Use bash to print the current directory and list the top-level files.',
      '2. Read README.md and data/input.txt.',
      '3. Write src/summary.txt with one bullet for alpha, beta, and gamma.',
      '4. Use the edit tool to append a line that says "status: edited".',
      '5. Run: node scripts/noisy-output.mjs | tail -n 5',
      '6. Reply with DONE and a one-sentence summary.',
    ].join('\n'),
    streamCallbacks: callbacks,
  });

  const summaryPath = path.join(workspace, 'src', 'summary.txt');
  const summaryFile = await readFile(summaryPath, 'utf8').catch(() => undefined);
  const durationMs = Date.now() - startedAt;

  console.log(
    JSON.stringify(
      {
        duration_ms: durationMs,
        log_dir: logDir,
        message_count: response.output?.length ?? 0,
        model: options.model,
        summary_file_present: summaryFile !== undefined,
        tool_call_count: countToolCalls(response.output),
        tool_events: toolEvents,
        workspace,
      },
      null,
      2,
    ),
  );
  const finalText = summarizeLastAssistant(response.output);
  if (finalText) {
    console.log('\nFinal assistant excerpt:\n');
    console.log(finalText);
  }
  if (summaryFile) {
    console.log('\nsrc/summary.txt:\n');
    console.log(summaryFile);
  }
}

process.once('uncaughtException', (error) => {
  console.error('[pi-debug] uncaughtException');
  console.error(error);
  process.exit(1);
});

process.once('unhandledRejection', (error) => {
  console.error('[pi-debug] unhandledRejection');
  console.error(error);
  process.exit(1);
});

main().catch((error) => {
  console.error('[pi-debug] failed');
  console.error(error);
  process.exit(1);
});
