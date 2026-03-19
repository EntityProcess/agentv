import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateConfigFile } from '../../../src/evaluation/validation/config-validator.js';

describe('validateConfigFile', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-config-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('accepts required_version field without warnings', async () => {
    const filePath = path.join(tempDir, 'config.yaml');
    await writeFile(
      filePath,
      `required_version: ">=3.1.0"
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts execution field without warnings', async () => {
    const filePath = path.join(tempDir, 'config-exec.yaml');
    await writeFile(
      filePath,
      `execution:
  timeout: 30000
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on invalid required_version type', async () => {
    const filePath = path.join(tempDir, 'config-bad-version.yaml');
    await writeFile(filePath, 'required_version: 3\n');

    const result = await validateConfigFile(filePath);

    const fieldErrors = result.errors.filter(
      (e) => e.severity === 'error' && e.location === 'required_version',
    );
    expect(fieldErrors).toHaveLength(1);
  });

  it('warns on truly unexpected fields', async () => {
    const filePath = path.join(tempDir, 'config-unexpected.yaml');
    await writeFile(filePath, 'foo: bar\n');

    const result = await validateConfigFile(filePath);

    const warnings = result.errors.filter((e) => e.severity === 'warning');
    expect(warnings.some((e) => e.message.includes('Unexpected fields: foo'))).toBe(true);
  });
});
