import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeWorkspaceFingerprint } from '../../../src/evaluation/workspace/fingerprint.js';

describe('Workspace Fingerprint', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(tmpdir(), `agentv-fp-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should compute a sha256 fingerprint of workspace files', async () => {
    const wsDir = path.join(testDir, 'ws1');
    await mkdir(wsDir, { recursive: true });
    await writeFile(path.join(wsDir, 'file1.txt'), 'hello');
    await writeFile(path.join(wsDir, 'file2.txt'), 'world');

    const fp = await computeWorkspaceFingerprint(wsDir);
    expect(fp.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fp.fileCount).toBe(2);
  });

  it('should produce the same hash for identical workspace contents', async () => {
    const ws1 = path.join(testDir, 'ws-same-1');
    const ws2 = path.join(testDir, 'ws-same-2');
    await mkdir(ws1, { recursive: true });
    await mkdir(ws2, { recursive: true });
    await writeFile(path.join(ws1, 'a.txt'), 'content-a');
    await writeFile(path.join(ws2, 'a.txt'), 'content-a');

    const fp1 = await computeWorkspaceFingerprint(ws1);
    const fp2 = await computeWorkspaceFingerprint(ws2);
    expect(fp1.hash).toBe(fp2.hash);
  });

  it('should produce different hashes for different contents', async () => {
    const ws1 = path.join(testDir, 'ws-diff-1');
    const ws2 = path.join(testDir, 'ws-diff-2');
    await mkdir(ws1, { recursive: true });
    await mkdir(ws2, { recursive: true });
    await writeFile(path.join(ws1, 'a.txt'), 'content-a');
    await writeFile(path.join(ws2, 'a.txt'), 'content-b');

    const fp1 = await computeWorkspaceFingerprint(ws1);
    const fp2 = await computeWorkspaceFingerprint(ws2);
    expect(fp1.hash).not.toBe(fp2.hash);
  });

  it('should skip .git directory', async () => {
    const wsDir = path.join(testDir, 'ws-git');
    await mkdir(wsDir, { recursive: true });
    await mkdir(path.join(wsDir, '.git'), { recursive: true });
    await writeFile(path.join(wsDir, '.git', 'HEAD'), 'ref: refs/heads/main');
    await writeFile(path.join(wsDir, 'file.txt'), 'content');

    const fp = await computeWorkspaceFingerprint(wsDir);
    expect(fp.fileCount).toBe(1);
  });

  it('should handle subdirectories', async () => {
    const wsDir = path.join(testDir, 'ws-sub');
    await mkdir(path.join(wsDir, 'src'), { recursive: true });
    await writeFile(path.join(wsDir, 'src', 'index.ts'), 'console.log("hi")');
    await writeFile(path.join(wsDir, 'package.json'), '{}');

    const fp = await computeWorkspaceFingerprint(wsDir);
    expect(fp.fileCount).toBe(2);
    expect(fp.hash).toMatch(/^sha256:/);
  });

  it('should handle empty workspace', async () => {
    const wsDir = path.join(testDir, 'ws-empty');
    await mkdir(wsDir, { recursive: true });

    const fp = await computeWorkspaceFingerprint(wsDir);
    expect(fp.fileCount).toBe(0);
    expect(fp.hash).toMatch(/^sha256:/);
  });
});
