import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateTargetsFile } from '../../../src/evaluation/validation/targets-validator.js';

describe('validateTargetsFile', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-targets-validator-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects removed target-level workspace_template field', async () => {
    const filePath = path.join(tempDir, 'removed-workspace-template.yaml');
    await writeFile(
      filePath,
      `targets:
  - name: test-target
    provider: codex-cli
    workspace_template: ./template
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].workspace_template' &&
          error.message.includes('workspace_template has been removed'),
      ),
    ).toBe(true);
  });

  it('rejects removed target-level workspaceTemplate camelCase field', async () => {
    const filePath = path.join(tempDir, 'removed-workspace-template-camel.yaml');
    await writeFile(
      filePath,
      `targets:
  - name: test-target
    provider: codex-cli
    workspaceTemplate: ./template
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].workspaceTemplate' &&
          error.message.includes('workspace_template has been removed'),
      ),
    ).toBe(true);
  });
});
