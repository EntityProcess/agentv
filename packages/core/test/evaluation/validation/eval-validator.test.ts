import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateEvalFile } from '../../../src/evaluation/validation/eval-validator.js';

describe('validateEvalFile', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('validates eval file with input alias string shorthand', async () => {
    const filePath = path.join(tempDir, 'input-alias.yaml');
    await writeFile(
      filePath,
      `cases:
  - id: test-1
    criteria: Goal
    input: "What is 2+2?"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file with input alias message array', async () => {
    const filePath = path.join(tempDir, 'input-array.yaml');
    await writeFile(
      filePath,
      `cases:
  - id: test-1
    criteria: Goal
    input:
      - role: system
        content: Be helpful
      - role: user
        content: Hello
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file with expected_output alias string shorthand', async () => {
    const filePath = path.join(tempDir, 'output-string.yaml');
    await writeFile(
      filePath,
      `cases:
  - id: test-1
    criteria: Goal
    input: Query
    expected_output: "The answer is 4"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file with expected_output alias object shorthand', async () => {
    const filePath = path.join(tempDir, 'output-object.yaml');
    await writeFile(
      filePath,
      `cases:
  - id: test-1
    criteria: Goal
    input: Query
    expected_output:
      riskLevel: High
      confidence: 0.95
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects eval file without input_messages or input alias', async () => {
    const filePath = path.join(tempDir, 'missing-input.yaml');
    await writeFile(
      filePath,
      `cases:
  - id: test-1
    criteria: Goal
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'input_messages' or 'input'"))).toBe(true);
  });

  it('rejects eval file with invalid input alias type', async () => {
    const filePath = path.join(tempDir, 'invalid-input.yaml');
    await writeFile(
      filePath,
      `cases:
  - id: test-1
    criteria: Goal
    input: 123
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'input'"))).toBe(true);
  });

  it('validates canonical input_messages when both canonical and alias present', async () => {
    const filePath = path.join(tempDir, 'canonical-precedence.yaml');
    await writeFile(
      filePath,
      `cases:
  - id: test-1
    criteria: Goal
    input_messages:
      - role: user
        content: Canonical
    input: "Alias should be ignored for validation purposes"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
