import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { prepareDockerEnvironment } from '../../../src/evaluation/environment/docker.js';
import type {
  CommandExecutor,
  ExecResult,
} from '../../../src/evaluation/workspace/docker-workspace.js';

class MockExecutor implements CommandExecutor {
  readonly calls: Array<{
    argv: readonly string[];
    options?: { timeoutMs?: number; stdin?: string };
  }> = [];
  private responses: ExecResult[] = [];

  pushResponse(response: Partial<ExecResult>): void {
    this.responses.push({ stdout: '', stderr: '', exitCode: 0, ...response });
  }

  async exec(
    argv: readonly string[],
    options?: { timeoutMs?: number; stdin?: string },
  ): Promise<ExecResult> {
    this.calls.push({ argv, options });
    return this.responses.shift() ?? { stdout: '', stderr: '', exitCode: 0 };
  }
}

describe('prepareDockerEnvironment', () => {
  it('pulls image recipes and exposes a sandbox target runtime', async () => {
    const executor = new MockExecutor();
    executor.pushResponse({ stdout: '24.0.0' });
    executor.pushResponse({ exitCode: 1 });
    executor.pushResponse({ stdout: 'pulled' });

    const result = await prepareDockerEnvironment(
      {
        type: 'docker',
        image: 'node:22-alpine',
        workdir: '/app',
        sourceDir: '/evals',
        env: { CASE_ENV: '1' },
        resources: { cpus: 1.5, memory: '1g' },
        mounts: [{ source: '/host/repo', target: '/repo', read_only: true }],
      },
      executor,
    );

    expect(executor.calls.map((call) => call.argv)).toEqual([
      ['docker', 'version', '--format', '{{.Server.Version}}'],
      ['docker', 'image', 'inspect', 'node:22-alpine'],
      ['docker', 'pull', 'node:22-alpine'],
    ]);
    expect(result.status).toBe('skipped');
    const tempDir = path.resolve(tmpdir());
    expect(result.targetRuntime).toMatchObject({
      mode: 'sandbox',
      engine: 'docker',
      image: 'node:22-alpine',
      workdir: '/app',
      host_cwd: '/evals',
      env: { CASE_ENV: '1', AGENTV_ENVIRONMENT_WORKDIR: '/app' },
      cpus: 1.5,
      memory: '1g',
    });
    expect(result.targetRuntime.mounts).toEqual([
      { source: '/host/repo', target: '/repo', access: 'ro' },
      { source: tempDir, target: tempDir, access: 'rw' },
    ]);
  });

  it('builds context recipes with dockerfile and schedules setup before target commands', async () => {
    const executor = new MockExecutor();
    executor.pushResponse({ stdout: '24.0.0' });
    executor.pushResponse({ stdout: 'built' });

    const result = await prepareDockerEnvironment(
      {
        type: 'docker',
        image: 'agentv/example:local',
        context: '/tmp/context',
        dockerfile: '/tmp/context/Dockerfile.agentv',
        workdir: '/workspace',
        sourceDir: '/evals',
        setup: {
          command: ['node', 'setup.mjs', '--repo', 'fixture'],
          cwd: '.',
          timeoutMs: 3000,
        },
      },
      executor,
    );

    expect(executor.calls.map((call) => call.argv)).toEqual([
      ['docker', 'version', '--format', '{{.Server.Version}}'],
      [
        'docker',
        'build',
        '-t',
        'agentv/example:local',
        '-f',
        '/tmp/context/Dockerfile.agentv',
        '/tmp/context',
      ],
    ]);
    expect(result.status).toBe('success');
    expect(result.targetRuntime.setup).toEqual([
      {
        command: ['node', 'setup.mjs', '--repo', 'fixture'],
        cwd: '/workspace',
        stdin: expect.stringContaining('"workdir": "/workspace"'),
        timeout_ms: 3000,
      },
    ]);
  });

  it('does not add a duplicate temp mount when the recipe already mounts that target', async () => {
    const executor = new MockExecutor();
    executor.pushResponse({ stdout: '24.0.0' });
    executor.pushResponse({ exitCode: 0 });
    const tempDir = path.resolve(tmpdir());

    const result = await prepareDockerEnvironment(
      {
        type: 'docker',
        image: 'alpine:3.20',
        workdir: '/app',
        sourceDir: '/evals',
        mounts: [{ source: tempDir, target: tempDir, access: 'rw' }],
      },
      executor,
    );

    expect(result.targetRuntime.mounts).toEqual([
      { source: tempDir, target: tempDir, access: 'rw' },
    ]);
  });
});
