import { describe, expect, it } from 'bun:test';

import { execShellWithStdin } from '../../src/runtime/exec.js';

describe('execShellWithStdin', () => {
  it('passes stdin payload to the child process', async () => {
    const payload = 'hello-world';
    const result = await execShellWithStdin('cat', payload);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(payload);
    expect(result.stderr).toBe('');
  });

  it('returns stderr and exit code for failing commands', async () => {
    const result = await execShellWithStdin('echo test-error 1>&2; exit 2', '');

    expect(result.exitCode).toBe(2);
    expect(result.stdout.trim()).toBe('');
    expect(result.stderr).toContain('test-error');
  });
});
