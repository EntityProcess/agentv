import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateWorkspacePaths } from '../../../src/evaluation/validation/workspace-path-validator.js';

const minimalEvalPrefix = `tests:
  - id: t1
    criteria: Goal
    input: hello
`;

describe('validateWorkspacePaths', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-workspace-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns no errors when workspace field is absent', async () => {
    const filePath = path.join(tempDir, 'no-workspace.yaml');
    await writeFile(filePath, minimalEvalPrefix);
    const errors = await validateWorkspacePaths(filePath);
    expect(errors).toHaveLength(0);
  });

  it('returns no errors when workspace file reference exists (with no internal paths)', async () => {
    const wsFilePath = path.join(tempDir, 'workspace.yaml');
    await writeFile(wsFilePath, 'template: ~\n');

    const evalFilePath = path.join(tempDir, 'eval-ws-ref-ok.yaml');
    await writeFile(evalFilePath, `${minimalEvalPrefix}workspace: workspace.yaml\n`);

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(0);
  });

  it('returns no errors when workspace file is missing (eval-validator owns that check)', async () => {
    const evalFilePath = path.join(tempDir, 'eval-ws-ref-missing.yaml');
    await writeFile(evalFilePath, `${minimalEvalPrefix}workspace: missing-workspace.yaml\n`);

    // eval-validator already catches the missing file error; this validator silently skips
    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(0);
  });

  it('errors when workspace.template does not exist (inline workspace)', async () => {
    const evalFilePath = path.join(tempDir, 'eval-inline-template.yaml');
    await writeFile(
      evalFilePath,
      `${minimalEvalPrefix}workspace:\n  template: nonexistent-template\n`,
    );

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe('error');
    expect(errors[0]?.location).toBe('workspace.template');
    expect(errors[0]?.message).toContain('Template path not found');
  });

  it('returns no errors when workspace.template exists', async () => {
    const templateDir = path.join(tempDir, 'my-template');
    await mkdir(templateDir, { recursive: true });

    const evalFilePath = path.join(tempDir, 'eval-template-ok.yaml');
    await writeFile(evalFilePath, `${minimalEvalPrefix}workspace:\n  template: my-template\n`);

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(0);
  });

  it('errors when hook before_all command has a missing relative script', async () => {
    const evalFilePath = path.join(tempDir, 'eval-hook-missing.yaml');
    await writeFile(
      evalFilePath,
      `${minimalEvalPrefix}workspace:
  hooks:
    before_all:
      command:
        - node
        - ../../scripts/setup.mjs
`,
    );

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe('error');
    expect(errors[0]?.location).toBe('workspace.hooks.before_all.command[1]');
    expect(errors[0]?.message).toContain('setup.mjs');
  });

  it('returns no errors when hook script exists at resolved path', async () => {
    const scriptsDir = path.join(tempDir, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    const setupScript = path.join(scriptsDir, 'setup.mjs');
    await writeFile(setupScript, 'console.log("setup");');

    const evalFilePath = path.join(tempDir, 'eval-hook-ok.yaml');
    await writeFile(
      evalFilePath,
      `${minimalEvalPrefix}workspace:
  hooks:
    before_all:
      command:
        - node
        - ./scripts/setup.mjs
`,
    );

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(0);
  });

  it('does not flag system binaries (no extension, no relative prefix)', async () => {
    const evalFilePath = path.join(tempDir, 'eval-system-binary.yaml');
    await writeFile(
      evalFilePath,
      `${minimalEvalPrefix}workspace:
  hooks:
    before_all:
      command:
        - bash
        - -c
        - echo hello
`,
    );

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(0);
  });

  it('checks hooks inside external workspace file', async () => {
    const wsFilePath = path.join(tempDir, 'ws-with-hooks.yaml');
    await writeFile(
      wsFilePath,
      `hooks:
  before_all:
    command:
      - node
      - ./missing-setup.mjs
`,
    );

    const evalFilePath = path.join(tempDir, 'eval-ws-hooks.yaml');
    await writeFile(evalFilePath, `${minimalEvalPrefix}workspace: ws-with-hooks.yaml\n`);

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('missing-setup.mjs');
  });

  it('checks template inside external workspace file', async () => {
    const wsFilePath = path.join(tempDir, 'ws-with-template.yaml');
    await writeFile(wsFilePath, 'template: ./missing-template\n');

    const evalFilePath = path.join(tempDir, 'eval-ws-template.yaml');
    await writeFile(evalFilePath, `${minimalEvalPrefix}workspace: ws-with-template.yaml\n`);

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.location).toBe('workspace.template');
    expect(errors[0]?.message).toContain('missing-template');
  });

  it('respects hook cwd for script path resolution', async () => {
    const subDir = path.join(tempDir, 'sub');
    await mkdir(subDir, { recursive: true });
    const scriptPath = path.join(subDir, 'run.sh');
    await writeFile(scriptPath, '#!/bin/bash\necho run');

    const evalFilePath = path.join(tempDir, 'eval-hook-cwd.yaml');
    await writeFile(
      evalFilePath,
      `${minimalEvalPrefix}workspace:
  hooks:
    before_all:
      cwd: ./sub
      command:
        - bash
        - ./run.sh
`,
    );

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(0);
  });

  it('checks after_each and after_all hooks too', async () => {
    const evalFilePath = path.join(tempDir, 'eval-other-hooks.yaml');
    await writeFile(
      evalFilePath,
      `${minimalEvalPrefix}workspace:
  hooks:
    after_each:
      command:
        - node
        - ./missing-after-each.mjs
    after_all:
      command:
        - node
        - ./missing-after-all.mjs
`,
    );

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.message.includes('missing-after-each.mjs'))).toBe(true);
    expect(errors.some((e) => e.message.includes('missing-after-all.mjs'))).toBe(true);
  });

  it('supports deprecated script alias', async () => {
    const evalFilePath = path.join(tempDir, 'eval-script-alias.yaml');
    await writeFile(
      evalFilePath,
      `${minimalEvalPrefix}workspace:
  hooks:
    before_all:
      script:
        - node
        - ./missing-via-alias.mjs
`,
    );

    const errors = await validateWorkspacePaths(evalFilePath);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('missing-via-alias.mjs');
  });
});
