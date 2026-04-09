import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CommandExecutor,
  DockerWorkspaceProvider,
  type ExecResult,
} from '../../../src/evaluation/workspace/docker-workspace.js';

/**
 * Mock command executor for testing Docker workspace provider.
 * Records all calls and returns configurable responses.
 */
class MockExecutor implements CommandExecutor {
  readonly calls: Array<{
    argv: readonly string[];
    options?: { timeoutMs?: number; stdin?: string };
  }> = [];
  private responses: ExecResult[] = [];
  private defaultResponse: ExecResult = { stdout: '', stderr: '', exitCode: 0 };

  /** Queue a response for the next exec call */
  pushResponse(response: Partial<ExecResult>): void {
    this.responses.push({ ...this.defaultResponse, ...response });
  }

  /** Set the default response for all unqueued calls */
  setDefault(response: Partial<ExecResult>): void {
    this.defaultResponse = { ...this.defaultResponse, ...response };
  }

  async exec(
    argv: readonly string[],
    options?: { timeoutMs?: number; stdin?: string },
  ): Promise<ExecResult> {
    this.calls.push({ argv, options });
    return this.responses.shift() ?? { ...this.defaultResponse };
  }

  /** Get the argv of the Nth call (0-indexed) */
  callArgv(n: number): readonly string[] {
    return this.calls[n]?.argv ?? [];
  }

  /** Get the options of the Nth call */
  callOptions(n: number): { timeoutMs?: number; stdin?: string } | undefined {
    return this.calls[n]?.options;
  }
}

describe('DockerWorkspaceProvider', () => {
  let executor: MockExecutor;

  beforeEach(() => {
    executor = new MockExecutor();
  });

  describe('isDockerAvailable', () => {
    it('returns true when docker version succeeds', async () => {
      executor.pushResponse({ stdout: '24.0.7', exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'test:latest' }, executor);
      expect(await provider.isDockerAvailable()).toBe(true);
      expect(executor.callArgv(0)).toEqual([
        'docker',
        'version',
        '--format',
        '{{.Server.Version}}',
      ]);
    });

    it('returns false when docker version fails', async () => {
      executor.pushResponse({ exitCode: 1, stderr: 'command not found' });
      const provider = new DockerWorkspaceProvider({ image: 'test:latest' }, executor);
      expect(await provider.isDockerAvailable()).toBe(false);
    });

    it('returns false when executor throws', async () => {
      const throwingExecutor: CommandExecutor = {
        exec: async () => {
          throw new Error('not found');
        },
      };
      const provider = new DockerWorkspaceProvider({ image: 'test:latest' }, throwingExecutor);
      expect(await provider.isDockerAvailable()).toBe(false);
    });
  });

  describe('pullImage', () => {
    it('skips pull when image exists locally', async () => {
      // docker image inspect succeeds → image exists locally
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'myimage:v1' }, executor);
      await provider.pullImage();
      expect(executor.callArgv(0)).toEqual(['docker', 'image', 'inspect', 'myimage:v1']);
      expect(executor.calls.length).toBe(1); // no pull call
    });

    it('calls docker pull when image not found locally', async () => {
      // docker image inspect fails → pull needed
      executor.pushResponse({ exitCode: 1, stderr: 'No such image' });
      executor.pushResponse({ stdout: 'Pull complete\n', exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'myimage:v1' }, executor);
      await provider.pullImage();
      expect(executor.callArgv(0)).toEqual(['docker', 'image', 'inspect', 'myimage:v1']);
      expect(executor.callArgv(1)).toEqual(['docker', 'pull', 'myimage:v1']);
    });

    it('throws on pull failure', async () => {
      // inspect fails, pull also fails
      executor.pushResponse({ exitCode: 1, stderr: 'No such image' });
      executor.pushResponse({ exitCode: 1, stderr: 'manifest not found' });
      const provider = new DockerWorkspaceProvider({ image: 'bad:image' }, executor);
      await expect(provider.pullImage()).rejects.toThrow('docker pull failed');
    });

    it('uses configured timeout for pull', async () => {
      // inspect fails, then pull happens with configured timeout
      executor.pushResponse({ exitCode: 1, stderr: 'No such image' });
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1', timeout: 60 }, executor);
      await provider.pullImage();
      // First call (inspect) uses 10s timeout
      expect(executor.callOptions(0)?.timeoutMs).toBe(10_000);
      // Second call (pull) uses configured timeout
      expect(executor.callOptions(1)?.timeoutMs).toBe(60_000);
    });
  });

  describe('createContainer', () => {
    it('creates container with image and sleep command', async () => {
      executor.pushResponse({ stdout: 'abc123\n', exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'myimage:v1' }, executor);
      const id = await provider.createContainer();
      expect(id).toBe('abc123');
      expect(executor.callArgv(0)).toEqual(['docker', 'create', 'myimage:v1', 'sleep', 'infinity']);
    });

    it('includes memory limit when configured', async () => {
      executor.pushResponse({ stdout: 'abc123\n', exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1', memory: '4g' }, executor);
      await provider.createContainer();
      expect(executor.callArgv(0)).toContain('--memory=4g');
    });

    it('includes CPU limit when configured', async () => {
      executor.pushResponse({ stdout: 'abc123\n', exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1', cpus: 2 }, executor);
      await provider.createContainer();
      expect(executor.callArgv(0)).toContain('--cpus=2');
    });

    it('includes both resource limits', async () => {
      executor.pushResponse({ stdout: 'abc123\n', exitCode: 0 });
      const provider = new DockerWorkspaceProvider(
        { image: 'img:1', memory: '2g', cpus: 0.5 },
        executor,
      );
      await provider.createContainer();
      const argv = executor.callArgv(0);
      expect(argv).toContain('--memory=2g');
      expect(argv).toContain('--cpus=0.5');
    });

    it('throws on create failure', async () => {
      executor.pushResponse({ exitCode: 125, stderr: 'no such image' });
      const provider = new DockerWorkspaceProvider({ image: 'bad:img' }, executor);
      await expect(provider.createContainer()).rejects.toThrow('docker create failed');
    });
  });

  describe('startContainer', () => {
    it('starts a container by ID', async () => {
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await provider.startContainer('abc123');
      expect(executor.callArgv(0)).toEqual(['docker', 'start', 'abc123']);
    });

    it('throws on start failure', async () => {
      executor.pushResponse({ exitCode: 1, stderr: 'container not found' });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await expect(provider.startContainer('bad')).rejects.toThrow('docker start failed');
    });
  });

  describe('resetContainerCheckout', () => {
    it('resets the container to repo checkout targets and verifies HEAD', async () => {
      executor.pushResponse({ exitCode: 0 }); // docker start
      executor.pushResponse({ exitCode: 0 }); // git reset --hard
      executor.pushResponse({ stdout: 'abc123\n', exitCode: 0 }); // git rev-parse HEAD

      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);

      await provider.startContainer('container-1');
      await provider.resetContainerCheckout('container-1', [{ path: '/testbed', ref: 'abc123' }]);

      expect(executor.callArgv(1)).toEqual([
        'docker',
        'exec',
        'container-1',
        'git',
        '-C',
        '/testbed',
        'reset',
        '--hard',
        'abc123',
      ]);
      expect(executor.callArgv(2)).toEqual([
        'docker',
        'exec',
        'container-1',
        'git',
        '-C',
        '/testbed',
        'rev-parse',
        'HEAD',
      ]);
    });

    it('skips reset when base_commit is not set', async () => {
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await provider.resetContainerCheckout('container-1');
      expect(executor.calls).toHaveLength(0);
    });

    it('resets multiple repos with different paths', async () => {
      executor.pushResponse({ exitCode: 0 }); // git reset --hard repo 1
      executor.pushResponse({ stdout: 'abc123\n', exitCode: 0 }); // git rev-parse HEAD repo 1
      executor.pushResponse({ exitCode: 0 }); // git reset --hard repo 2
      executor.pushResponse({ stdout: 'def456\n', exitCode: 0 }); // git rev-parse HEAD repo 2

      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);

      await provider.resetContainerCheckout('container-1', [
        { path: '/testbed', ref: 'abc123' },
        { path: '/app', ref: 'def456' },
      ]);

      expect(executor.callArgv(0)).toEqual([
        'docker',
        'exec',
        'container-1',
        'git',
        '-C',
        '/testbed',
        'reset',
        '--hard',
        'abc123',
      ]);
      expect(executor.callArgv(2)).toEqual([
        'docker',
        'exec',
        'container-1',
        'git',
        '-C',
        '/app',
        'reset',
        '--hard',
        'def456',
      ]);
    });
  });

  describe('runGraderInContainer', () => {
    it('resets the container to repo checkout targets before running the grader', async () => {
      executor.pushResponse({ stdout: 'container-1\n', exitCode: 0 }); // docker create
      executor.pushResponse({ exitCode: 0 }); // docker start
      executor.pushResponse({ exitCode: 0 }); // git reset --hard
      executor.pushResponse({ stdout: 'abc123\n', exitCode: 0 }); // git rev-parse HEAD
      executor.pushResponse({ stdout: '{"score": 1, "assertions": []}', exitCode: 0 }); // grader
      executor.pushResponse({ exitCode: 0 }); // docker rm -f

      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);

      const result = await provider.runGraderInContainer({
        command: ['python', 'grade.py'],
        repoCheckouts: [{ path: '/testbed', ref: 'abc123' }],
      });

      expect(result.exitCode).toBe(0);
      expect(executor.callArgv(0)).toEqual(['docker', 'create', 'img:1', 'sleep', 'infinity']);
      expect(executor.callArgv(1)).toEqual(['docker', 'start', 'container-1']);
      expect(executor.callArgv(2)).toEqual([
        'docker',
        'exec',
        'container-1',
        'git',
        '-C',
        '/testbed',
        'reset',
        '--hard',
        'abc123',
      ]);
      expect(executor.callArgv(3)).toEqual([
        'docker',
        'exec',
        'container-1',
        'git',
        '-C',
        '/testbed',
        'rev-parse',
        'HEAD',
      ]);
      expect(executor.callArgv(4)).toEqual(['docker', 'exec', 'container-1', 'python', 'grade.py']);
    });
  });

  describe('copyToContainer', () => {
    it('copies local path to container path', async () => {
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await provider.copyToContainer('abc123', '/local/patch.diff', '/tmp/patch.diff');
      expect(executor.callArgv(0)).toEqual([
        'docker',
        'cp',
        '/local/patch.diff',
        'abc123:/tmp/patch.diff',
      ]);
    });

    it('throws on cp failure', async () => {
      executor.pushResponse({ exitCode: 1, stderr: 'no such container' });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await expect(provider.copyToContainer('bad', '/a', '/b')).rejects.toThrow('docker cp failed');
    });
  });

  describe('execInContainer', () => {
    it('executes command in container', async () => {
      executor.pushResponse({
        stdout: '{"score": 1.0, "assertions": []}',
        exitCode: 0,
      });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      const result = await provider.execInContainer({
        containerId: 'abc123',
        command: ['/bin/bash', '-c', 'python grade.py'],
      });
      expect(result.stdout).toContain('"score": 1.0');
      expect(executor.callArgv(0)).toEqual([
        'docker',
        'exec',
        'abc123',
        '/bin/bash',
        '-c',
        'python grade.py',
      ]);
    });

    it('adds -i flag when stdin is provided', async () => {
      executor.pushResponse({ stdout: '{}', exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await provider.execInContainer({
        containerId: 'abc123',
        command: ['cat'],
        stdin: 'hello',
      });
      expect(executor.callArgv(0)).toEqual(['docker', 'exec', '-i', 'abc123', 'cat']);
      expect(executor.callOptions(0)?.stdin).toBe('hello');
    });

    it('uses custom timeout', async () => {
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await provider.execInContainer({
        containerId: 'abc123',
        command: ['true'],
        timeoutMs: 5000,
      });
      expect(executor.callOptions(0)?.timeoutMs).toBe(5000);
    });

    it('uses default timeout from config', async () => {
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1', timeout: 120 }, executor);
      await provider.execInContainer({
        containerId: 'abc123',
        command: ['true'],
      });
      expect(executor.callOptions(0)?.timeoutMs).toBe(120_000);
    });
  });

  describe('removeContainer', () => {
    it('force-removes a container', async () => {
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await provider.removeContainer('abc123');
      expect(executor.callArgv(0)).toEqual(['docker', 'rm', '-f', 'abc123']);
    });

    it('does not throw when removal fails', async () => {
      executor.pushResponse({ exitCode: 1, stderr: 'no such container' });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      // Should not throw
      await provider.removeContainer('nonexistent');
    });

    it('does not throw when executor throws', async () => {
      const throwingExecutor: CommandExecutor = {
        exec: async () => {
          throw new Error('connection refused');
        },
      };
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, throwingExecutor);
      await provider.removeContainer('abc123');
    });
  });

  describe('runGraderInContainer', () => {
    it('runs full lifecycle: create → start → exec → cleanup', async () => {
      // create returns container ID
      executor.pushResponse({ stdout: 'container-id-123\n', exitCode: 0 });
      // start succeeds
      executor.pushResponse({ exitCode: 0 });
      // exec returns grader output
      executor.pushResponse({
        stdout: '{"score": 0.75, "assertions": [{"text": "test passed", "passed": true}]}',
        exitCode: 0,
      });
      // rm succeeds
      executor.pushResponse({ exitCode: 0 });

      const provider = new DockerWorkspaceProvider({ image: 'test:latest' }, executor);
      const result = await provider.runGraderInContainer({
        command: ['python', 'grade.py'],
        stdin: '{"input": "test"}',
      });

      expect(result.stdout).toContain('"score": 0.75');
      expect(executor.calls).toHaveLength(4);
      // Verify lifecycle order: create, start, exec, rm
      expect(executor.callArgv(0)[1]).toBe('create');
      expect(executor.callArgv(1)[1]).toBe('start');
      expect(executor.callArgv(2)[1]).toBe('exec');
      expect(executor.callArgv(3)[1]).toBe('rm');
    });

    it('copies files before exec when copyFiles is specified', async () => {
      executor.pushResponse({ stdout: 'cid\n', exitCode: 0 }); // create
      executor.pushResponse({ exitCode: 0 }); // start
      executor.pushResponse({ exitCode: 0 }); // cp file 1
      executor.pushResponse({ exitCode: 0 }); // cp file 2
      executor.pushResponse({ stdout: '{"score": 1}', exitCode: 0 }); // exec
      executor.pushResponse({ exitCode: 0 }); // rm

      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await provider.runGraderInContainer({
        command: ['grade'],
        copyFiles: [
          { localPath: '/host/a.diff', containerPath: '/tmp/a.diff' },
          { localPath: '/host/b.txt', containerPath: '/tmp/b.txt' },
        ],
      });

      expect(executor.calls).toHaveLength(6);
      expect(executor.callArgv(2)).toEqual(['docker', 'cp', '/host/a.diff', 'cid:/tmp/a.diff']);
      expect(executor.callArgv(3)).toEqual(['docker', 'cp', '/host/b.txt', 'cid:/tmp/b.txt']);
    });

    it('cleans up container even when exec fails', async () => {
      executor.pushResponse({ stdout: 'cid\n', exitCode: 0 }); // create
      executor.pushResponse({ exitCode: 0 }); // start
      executor.pushResponse({ exitCode: 1, stderr: 'grader crashed' }); // exec fails
      executor.pushResponse({ exitCode: 0 }); // rm (cleanup)

      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      const result = await provider.runGraderInContainer({
        command: ['grade'],
      });

      // Should return the error result, not throw
      expect(result.exitCode).toBe(1);
      // Container should still be cleaned up
      expect(executor.calls).toHaveLength(4);
      expect(executor.callArgv(3)[1]).toBe('rm');
    });

    it('cleans up container even when start fails', async () => {
      executor.pushResponse({ stdout: 'cid\n', exitCode: 0 }); // create
      executor.pushResponse({ exitCode: 1, stderr: 'start failed' }); // start fails
      executor.pushResponse({ exitCode: 0 }); // rm (cleanup)

      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await expect(provider.runGraderInContainer({ command: ['grade'] })).rejects.toThrow(
        'docker start failed',
      );

      // Container should still be cleaned up
      const rmCall = executor.calls.find((c) => c.argv[1] === 'rm');
      expect(rmCall).toBeDefined();
      expect(rmCall?.argv).toEqual(['docker', 'rm', '-f', 'cid']);
    });
  });

  describe('timeout configuration', () => {
    it('defaults to 1800s (30 min) timeout for pull', async () => {
      // inspect fails → pull with default timeout
      executor.pushResponse({ exitCode: 1, stderr: 'No such image' });
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1' }, executor);
      await provider.pullImage();
      // Pull call (second) uses default timeout
      expect(executor.callOptions(1)?.timeoutMs).toBe(1_800_000);
    });

    it('uses custom timeout from config', async () => {
      // inspect fails → pull with custom timeout
      executor.pushResponse({ exitCode: 1, stderr: 'No such image' });
      executor.pushResponse({ exitCode: 0 });
      const provider = new DockerWorkspaceProvider({ image: 'img:1', timeout: 300 }, executor);
      await provider.pullImage();
      // Pull call (second) uses custom timeout
      expect(executor.callOptions(1)?.timeoutMs).toBe(300_000);
    });
  });
});
