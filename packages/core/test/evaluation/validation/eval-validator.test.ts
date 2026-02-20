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
      `tests:
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
      `tests:
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
      `tests:
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
      `tests:
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

  it('rejects eval file without input field', async () => {
    const filePath = path.join(tempDir, 'missing-input.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'input'"))).toBe(true);
  });

  it('rejects eval file with invalid input alias type', async () => {
    const filePath = path.join(tempDir, 'invalid-input.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input: 123
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'input'"))).toBe(true);
  });

  it('validates input message array', async () => {
    const filePath = path.join(tempDir, 'input-messages.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input:
      - role: user
        content: Hello
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  describe('assert field validation', () => {
    it('validates assert array items have type field', async () => {
      const filePath = path.join(tempDir, 'assert-missing-type.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - value: test
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'type'"))).toBe(true);
    });

    it('warns on invalid assert type', async () => {
      const filePath = path.join(tempDir, 'assert-invalid-type.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: invalid_evaluator
        value: test
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('invalid_evaluator'))).toBe(true);
    });

    it('validates contains assertion has value field', async () => {
      const filePath = path.join(tempDir, 'assert-contains-no-value.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'value'"))).toBe(true);
    });

    it('validates equals assertion has value field', async () => {
      const filePath = path.join(tempDir, 'assert-equals-no-value.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: equals
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'value'"))).toBe(true);
    });

    it('validates regex assertion has valid pattern', async () => {
      const filePath = path.join(tempDir, 'assert-regex-invalid.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: regex
        value: "[invalid"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('regex'))).toBe(true);
    });

    it('validates regex assertion has value field', async () => {
      const filePath = path.join(tempDir, 'assert-regex-no-value.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: regex
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'value'"))).toBe(true);
    });

    it('validates is_json needs no additional fields', async () => {
      const filePath = path.join(tempDir, 'assert-is-json.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Return JSON"
    assert:
      - type: is_json
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });

    it('validates required field accepts boolean', async () => {
      const filePath = path.join(tempDir, 'assert-required-bool.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: true
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });

    it('validates required field accepts number between 0 and 1', async () => {
      const filePath = path.join(tempDir, 'assert-required-number.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: 0.8
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });

    it('warns on invalid required field type', async () => {
      const filePath = path.join(tempDir, 'assert-required-invalid.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: "yes"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('warns on required number out of range (0)', async () => {
      const filePath = path.join(tempDir, 'assert-required-zero.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: 0
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('warns on required number out of range (> 1)', async () => {
      const filePath = path.join(tempDir, 'assert-required-over-one.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: 1.5
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('warns when assert is not an array', async () => {
      const filePath = path.join(tempDir, 'assert-not-array.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert: "contains"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('assert'))).toBe(true);
    });

    it('warns when assert item is not an object', async () => {
      const filePath = path.join(tempDir, 'assert-item-not-object.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - "contains"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('object'))).toBe(true);
    });

    it('passes valid assert array', async () => {
      const filePath = path.join(tempDir, 'assert-valid.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Is this entity sanctioned?"
    assert:
      - type: contains
        value: DENIED
      - type: is_json
      - type: regex
        value: "\\\\d+"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('metadata validation', () => {
    it('warns when name is present without description', async () => {
      const filePath = path.join(tempDir, 'meta-name-only.yaml');
      await writeFile(
        filePath,
        `name: my-eval
tests:
  - id: test-1
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('description'))).toBe(true);
    });

    it('warns when name has invalid format', async () => {
      const filePath = path.join(tempDir, 'meta-invalid-name.yaml');
      await writeFile(
        filePath,
        `name: "Invalid Name!"
description: Some description
tests:
  - id: test-1
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('name'))).toBe(true);
    });

    it('passes valid metadata', async () => {
      const filePath = path.join(tempDir, 'meta-valid.yaml');
      await writeFile(
        filePath,
        `name: my-eval
description: A valid eval
tests:
  - id: test-1
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('tests as string path', () => {
    it('validates tests string has valid extension', async () => {
      const filePath = path.join(tempDir, 'tests-bad-ext.yaml');
      await writeFile(
        filePath,
        `tests: "./cases.txt"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('extension'))).toBe(true);
    });

    it('passes valid tests string path with .yaml extension', async () => {
      const filePath = path.join(tempDir, 'tests-yaml-ext.yaml');
      await writeFile(
        filePath,
        `tests: "./cases.yaml"
`,
      );

      const result = await validateEvalFile(filePath);

      // Should be valid (no errors), possibly no warnings about extension
      expect(result.valid).toBe(true);
      const extWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('extension'),
      );
      expect(extWarnings).toHaveLength(0);
    });

    it('passes valid tests string path with .yml extension', async () => {
      const filePath = path.join(tempDir, 'tests-yml-ext.yaml');
      await writeFile(
        filePath,
        `tests: "./cases.yml"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const extWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('extension'),
      );
      expect(extWarnings).toHaveLength(0);
    });

    it('passes valid tests string path with .jsonl extension', async () => {
      const filePath = path.join(tempDir, 'tests-jsonl-ext.yaml');
      await writeFile(
        filePath,
        `tests: "./cases.jsonl"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const extWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('extension'),
      );
      expect(extWarnings).toHaveLength(0);
    });
  });

  describe('backward-compat aliases', () => {
    it('accepts eval_cases as deprecated alias for tests (with warning)', async () => {
      const filePath = path.join(tempDir, 'eval-cases-alias.yaml');
      await writeFile(
        filePath,
        `eval_cases:
  - id: test-1
    criteria: Goal
    input:
      - role: user
        content: Query
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'eval_cases' is deprecated"))).toBe(true);
    });

    it('accepts evalcases as deprecated alias for tests (with warning)', async () => {
      const filePath = path.join(tempDir, 'evalcases-alias.yaml');
      await writeFile(
        filePath,
        `evalcases:
  - id: test-1
    criteria: Goal
    input:
      - role: user
        content: Query
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'evalcases' is deprecated"))).toBe(true);
    });

    it('accepts expected_outcome as deprecated alias for criteria (with warning)', async () => {
      const filePath = path.join(tempDir, 'expected-outcome-alias.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    expected_outcome: Goal
    input:
      - role: user
        content: Query
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'expected_outcome' is deprecated"))).toBe(
        true,
      );
    });
  });
});
