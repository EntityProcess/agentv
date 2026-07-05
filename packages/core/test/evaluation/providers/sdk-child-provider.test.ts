import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SdkChildProvider,
  SdkChildRunnerError,
} from '../../../src/evaluation/providers/sdk-child-provider.js';
import { extractLastAssistantContent } from '../../../src/evaluation/providers/types.js';

describe('SdkChildProvider', () => {
  let fixturesRoot: string;
  let runnerPath: string;

  beforeEach(async () => {
    fixturesRoot = await mkdtemp(path.join(tmpdir(), 'agentv-sdk-child-'));
    runnerPath = path.join(fixturesRoot, 'fake-sdk-runner.js');
    await writeFakeRunner(runnerPath);
  });

  afterEach(async () => {
    await rm(fixturesRoot, { recursive: true, force: true });
  });

  it('returns the final child result and keeps structured child events', async () => {
    const provider = fakeProvider('success');

    const response = await provider.invoke({ question: 'hello' });

    expect(extractLastAssistantContent(response.output)).toBe('child ok');
    const raw = response.raw as {
      child_runner?: { events?: readonly { message?: string }[]; stderr?: string };
    };
    expect(raw.child_runner?.events?.some((event) => event.message === 'fake event')).toBe(true);
    expect(raw.child_runner?.stderr).toContain('stderr log');
  });

  it('passes the provider kind, target config, and request through the child protocol', async () => {
    const provider = fakeProvider('request-plumbing', {
      model: 'gpt-5-codex',
      cwd: '/tmp/from-config',
    });

    const response = await provider.invoke({
      question: 'inspect this request',
      cwd: '/tmp/from-request',
      metadata: { run_id: 'run-123' },
      maxOutputTokens: 128,
    });

    expect(extractLastAssistantContent(response.output)).toBe('request received');
    expect(response.raw).toMatchObject({
      received_provider_kind: 'codex-sdk',
      received_target_name: 'fake-target',
      received_model: 'gpt-5-codex',
      received_question: 'inspect this request',
      received_cwd: '/tmp/from-request',
      received_metadata: { run_id: 'run-123' },
      received_max_output_tokens: 128,
    });
  });

  it('keeps missing SDK dependency errors scoped to the child runner', async () => {
    const provider = fakeProvider('dependency-error');

    try {
      await provider.invoke({ question: 'hello' });
      throw new Error('expected invoke to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SdkChildRunnerError);
      const runnerError = error as SdkChildRunnerError;
      expect(runnerError.reason).toBe('child_error');
      expect(runnerError.message).toContain('@openai/codex-sdk');
      expect(runnerError.message).toContain('bun install');
      expect(runnerError.details).toMatchObject({
        code: 'MissingSdkDependency',
      });
    }
  });

  it('maps fatal child exit before a result to a provider-scoped error', async () => {
    const provider = fakeProvider('fatal');

    await expect(provider.invoke({ question: 'hello' })).rejects.toThrow(SdkChildRunnerError);
    await expect(provider.invoke({ question: 'hello' })).rejects.toThrow(/exit code 7/);
  });

  it('maps malformed child stdout to a protocol error without crashing the parent', async () => {
    const provider = fakeProvider('malformed');

    await expect(provider.invoke({ question: 'hello' })).rejects.toThrow(/malformed_output/);

    const survivor = fakeProvider('success');
    const response = await survivor.invoke({ question: 'still alive' });
    expect(extractLastAssistantContent(response.output)).toBe('child ok');
  });

  it('kills the child process group on timeout', async () => {
    const provider = fakeProvider('hang', { timeoutMs: 50 });

    await expect(provider.invoke({ question: 'hello' })).rejects.toThrow(/timeout/);
  });

  it('kills the child process group on cancellation', async () => {
    const provider = fakeProvider('hang', { timeoutMs: 5_000 });
    const controller = new AbortController();
    const invoke = provider.invoke({ question: 'hello', signal: controller.signal });

    setTimeout(() => controller.abort(), 30);

    await expect(invoke).rejects.toThrow(/cancelled/);
  });

  function fakeProvider(mode: string, config: Record<string, unknown> = {}): SdkChildProvider {
    return new SdkChildProvider('codex-sdk', 'fake-target', config, {
      runnerArgv: [process.execPath, runnerPath, mode],
    });
  }
});

async function writeFakeRunner(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `
const mode = process.argv[2];
let requestEnvelope;
await new Promise((resolve) => {
  let body = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    body += chunk;
  });
  process.stdin.on('end', () => {
    requestEnvelope = JSON.parse(body.trim());
    resolve();
  });
});

function write(message) {
  process.stdout.write(JSON.stringify({ protocol_version: 1, ...message }) + '\\n');
}

if (mode === 'success') {
  console.error('stderr log');
  write({ type: 'event', event: { kind: 'provider_event', message: 'fake event' } });
  write({
    type: 'result',
    response: {
      output: [{ role: 'assistant', content: 'child ok' }],
      token_usage: { input: 1, output: 2 },
      duration_ms: 3,
    },
  });
  process.exit(0);
}

if (mode === 'request-plumbing') {
  write({
    type: 'result',
    response: {
      raw: {
        received_provider_kind: requestEnvelope.provider_kind,
        received_target_name: requestEnvelope.target_name,
        received_model: requestEnvelope.config.model,
        received_question: requestEnvelope.request.question,
        received_cwd: requestEnvelope.request.cwd,
        received_metadata: requestEnvelope.request.metadata,
        received_max_output_tokens: requestEnvelope.request.max_output_tokens,
      },
      output: [{ role: 'assistant', content: 'request received' }],
    },
  });
  process.exit(0);
}

if (mode === 'dependency-error') {
  write({
    type: 'error',
    error: {
      code: 'MissingSdkDependency',
      message: 'Failed to load @openai/codex-sdk. SDK beta optional dependencies are installed by default with bun install; if optional dependencies were omitted, run bun install or bun add --optional @openai/codex-sdk.',
    },
  });
  process.exit(1);
}

if (mode === 'fatal') {
  process.stderr.write('fatal before result');
  process.exit(7);
}

if (mode === 'malformed') {
  process.stdout.write('not-json\\n');
  setTimeout(() => process.exit(0), 1000);
}

if (mode === 'hang') {
  setInterval(() => {}, 1000);
}
`,
    'utf8',
  );
}
