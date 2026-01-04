import { describe, expect, it } from 'bun:test';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execFileWithStdin } from '../../src/runtime/exec.js';

describe('execFileWithStdin', () => {
  it('passes stdin payload to the child process', async () => {
    const payload = 'hello-world';
    // Create a temporary script file to avoid quote escaping issues
    const scriptPath = join(tmpdir(), `test-stdin-${Date.now()}.cjs`);
    writeFileSync(
      scriptPath,
      "const fs = require('fs'); process.stdin.on('data', d => process.stdout.write(d));",
    );

    try {
      const result = await execFileWithStdin(['node', scriptPath], payload);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(payload);
      expect(result.stderr).toBe('');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('returns stderr and exit code for failing commands', async () => {
    // Create a temporary script file to avoid quote escaping issues
    const scriptPath = join(tmpdir(), `test-stderr-${Date.now()}.cjs`);
    writeFileSync(scriptPath, "process.stderr.write('test-error\\n'); process.exit(2);");

    try {
      const result = await execFileWithStdin(['node', scriptPath], '');

      expect(result.exitCode).toBe(2);
      expect(result.stdout.trim()).toBe('');
      expect(result.stderr).toContain('test-error');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('handles large stdin payloads', async () => {
    const payload = 'x'.repeat(1024 * 1024 + 16);
    const scriptPath = join(tmpdir(), `test-large-${Date.now()}.cjs`);
    writeFileSync(
      scriptPath,
      "let data=''; process.stdin.on('data', d => data += d); process.stdin.on('end', () => process.stdout.write(String(Buffer.byteLength(data))));",
    );

    try {
      const result = await execFileWithStdin(['node', scriptPath], payload);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(String(Buffer.byteLength(payload)));
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('times out long-running processes', async () => {
    const scriptPath = join(tmpdir(), `test-timeout-${Date.now()}.cjs`);
    writeFileSync(scriptPath, 'setInterval(() => {}, 1000);');

    try {
      await expect(execFileWithStdin(['node', scriptPath], '', { timeoutMs: 50 })).rejects.toThrow(
        'Process timed out',
      );
    } finally {
      unlinkSync(scriptPath);
    }
  });
});
