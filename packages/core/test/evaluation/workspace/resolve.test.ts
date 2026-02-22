import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWorkspaceTemplate } from '../../../src/evaluation/workspace/resolve.js';

describe('resolveWorkspaceTemplate', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentv-resolve-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns undefined for undefined input', async () => {
    const result = await resolveWorkspaceTemplate(undefined);
    expect(result).toBeUndefined();
  });

  it('resolves .code-workspace file: dir=parent, workspaceFile=file', async () => {
    const wsFile = path.join(tempDir, 'project.code-workspace');
    await fs.writeFile(wsFile, JSON.stringify({ folders: [{ path: '.' }] }));

    const result = await resolveWorkspaceTemplate(wsFile);

    expect(result).toBeDefined();
    expect(result!.dir).toBe(tempDir);
    expect(result!.workspaceFile).toBe(wsFile);
  });

  it('resolves directory with 1 .code-workspace: auto-detects file', async () => {
    const wsFile = path.join(tempDir, 'my-project.code-workspace');
    await fs.writeFile(wsFile, JSON.stringify({ folders: [{ path: '.' }] }));
    await fs.writeFile(path.join(tempDir, 'README.md'), 'hello');

    const result = await resolveWorkspaceTemplate(tempDir);

    expect(result).toBeDefined();
    expect(result!.dir).toBe(tempDir);
    expect(result!.workspaceFile).toBe(wsFile);
  });

  it('resolves directory with multiple .code-workspace: uses template.code-workspace', async () => {
    await fs.writeFile(
      path.join(tempDir, 'dev.code-workspace'),
      JSON.stringify({ folders: [{ path: '.' }] }),
    );
    await fs.writeFile(
      path.join(tempDir, 'template.code-workspace'),
      JSON.stringify({ folders: [{ path: '.' }] }),
    );

    const result = await resolveWorkspaceTemplate(tempDir);

    expect(result).toBeDefined();
    expect(result!.dir).toBe(tempDir);
    expect(result!.workspaceFile).toBe(path.join(tempDir, 'template.code-workspace'));
  });

  it('resolves directory with multiple .code-workspace but no template.code-workspace: no workspaceFile', async () => {
    await fs.writeFile(
      path.join(tempDir, 'dev.code-workspace'),
      JSON.stringify({ folders: [{ path: '.' }] }),
    );
    await fs.writeFile(
      path.join(tempDir, 'prod.code-workspace'),
      JSON.stringify({ folders: [{ path: '.' }] }),
    );

    const result = await resolveWorkspaceTemplate(tempDir);

    expect(result).toBeDefined();
    expect(result!.dir).toBe(tempDir);
    expect(result!.workspaceFile).toBeUndefined();
  });

  it('resolves directory with no .code-workspace: dir only', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export {}');

    const result = await resolveWorkspaceTemplate(tempDir);

    expect(result).toBeDefined();
    expect(result!.dir).toBe(tempDir);
    expect(result!.workspaceFile).toBeUndefined();
  });

  it('throws for non-existent path', async () => {
    await expect(resolveWorkspaceTemplate('/no/such/path')).rejects.toThrow();
  });
});
