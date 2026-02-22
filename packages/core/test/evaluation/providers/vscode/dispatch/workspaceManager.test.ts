import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyAgentConfig } from '../../../../../src/evaluation/providers/vscode/dispatch/workspaceManager.js';

describe('copyAgentConfig', () => {
  let tempDir: string;
  let subagentDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentv-test-'));
    subagentDir = path.join(tempDir, 'subagent-1');
    await fs.mkdir(subagentDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // S1: default workspace (no template, no cwd)
  it('creates default workspace with subagent folder', async () => {
    const result = await copyAgentConfig(subagentDir);

    const content = JSON.parse(await fs.readFile(result.workspace, 'utf8'));
    expect(content.folders).toEqual(expect.arrayContaining([{ path: '.' }]));
    expect(result.workspace).toBe(path.join(subagentDir, 'subagent-1.code-workspace'));
  });

  // S2: workspace template file
  it('copies workspace template file and transforms paths', async () => {
    const templateDir = path.join(tempDir, 'templates');
    await fs.mkdir(templateDir, { recursive: true });
    const templateFile = path.join(templateDir, 'my.code-workspace');
    await fs.writeFile(
      templateFile,
      JSON.stringify({
        folders: [{ path: './src' }],
        settings: {},
      }),
    );

    const result = await copyAgentConfig(subagentDir, templateFile);

    const content = JSON.parse(await fs.readFile(result.workspace, 'utf8'));
    // transformWorkspacePaths prepends { path: '.' } and resolves relative paths
    expect(content.folders[0]).toEqual({ path: '.' });
    const srcFolder = content.folders.find(
      (f: { path: string }) => f.path === path.resolve(templateDir, 'src'),
    );
    expect(srcFolder).toBeDefined();
  });

  // S3: cwd only (no template)
  it('appends cwd as folder when no template provided', async () => {
    const cwdDir = path.join(tempDir, 'workspace');
    await fs.mkdir(cwdDir, { recursive: true });

    const result = await copyAgentConfig(subagentDir, undefined, cwdDir);

    const content = JSON.parse(await fs.readFile(result.workspace, 'utf8'));
    const cwdFolder = content.folders.find(
      (f: { path: string }) => f.path === path.resolve(cwdDir),
    );
    expect(cwdFolder).toBeDefined();
  });

  // S4: template + cwd (composition)
  it('includes both template folders and cwd folder', async () => {
    const templateDir = path.join(tempDir, 'templates');
    await fs.mkdir(templateDir, { recursive: true });
    const templateFile = path.join(templateDir, 'proj.code-workspace');
    await fs.writeFile(
      templateFile,
      JSON.stringify({
        folders: [{ path: './src' }],
      }),
    );
    const cwdDir = path.join(tempDir, 'eval-workspace');
    await fs.mkdir(cwdDir, { recursive: true });

    const result = await copyAgentConfig(subagentDir, templateFile, cwdDir);

    const content = JSON.parse(await fs.readFile(result.workspace, 'utf8'));
    // Should have: '.', resolved template src, and cwd
    expect(content.folders.length).toBe(3);
    expect(content.folders[0]).toEqual({ path: '.' });
    expect(content.folders[1]).toEqual({ path: path.resolve(templateDir, 'src') });
    expect(content.folders[2]).toEqual({ path: path.resolve(cwdDir) });
  });

  // S5: cwd deduplication — cwd already present in template folders
  it('does not duplicate cwd if already in folders', async () => {
    const cwdDir = path.join(tempDir, 'shared');
    await fs.mkdir(cwdDir, { recursive: true });
    const templateDir = path.join(tempDir, 'templates');
    await fs.mkdir(templateDir, { recursive: true });
    const templateFile = path.join(templateDir, 'proj.code-workspace');
    await fs.writeFile(
      templateFile,
      JSON.stringify({
        folders: [{ path: path.resolve(cwdDir) }],
      }),
    );

    const result = await copyAgentConfig(subagentDir, templateFile, cwdDir);

    const content = JSON.parse(await fs.readFile(result.workspace, 'utf8'));
    const cwdMatches = content.folders.filter(
      (f: { path: string }) => f.path === path.resolve(cwdDir),
    );
    expect(cwdMatches.length).toBe(1);
  });

  // S6: workspace file location — always in subagent dir with conventional name
  it('writes workspace file with subagent dir basename', async () => {
    const result = await copyAgentConfig(subagentDir);

    expect(result.workspace).toBe(path.join(subagentDir, 'subagent-1.code-workspace'));
    const exists = await fs
      .stat(result.workspace)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  // S7: messages directory is created
  it('creates messages directory', async () => {
    const result = await copyAgentConfig(subagentDir);

    expect(result.messagesDir).toBe(path.join(subagentDir, 'messages'));
    const exists = await fs
      .stat(result.messagesDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    expect(exists).toBe(true);
  });
});
