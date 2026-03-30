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
    assertions:
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
    assertions:
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
    assertions:
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
    assertions:
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
    assertions:
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
    assertions:
      - type: regex
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'value'"))).toBe(true);
    });

    it('validates is-json needs no additional fields', async () => {
      const filePath = path.join(tempDir, 'assert-is-json.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Return JSON"
    assertions:
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
    assertions:
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
    assertions:
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
    assertions:
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
    assertions:
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
    assertions:
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
    assertions: "contains"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('assertions'))).toBe(true);
    });

    it('accepts string shorthand in assertions array', async () => {
      const filePath = path.join(tempDir, 'assert-string-shorthand.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Explain quicksort"
    assertions:
      - Mentions divide-and-conquer approach
      - Explains partition step
      - States time complexity correctly
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('warns on non-string non-object assertion items', async () => {
      const filePath = path.join(tempDir, 'assert-item-not-object.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - 42
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('string or an object'))).toBe(true);
    });

    it('passes valid assert array', async () => {
      const filePath = path.join(tempDir, 'assert-valid.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Is this entity sanctioned?"
    assertions:
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
      await writeFile(
        path.join(tempDir, 'cases.yaml'),
        `- id: test-1
  criteria: Goal
  input: "Query"
`,
      );

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
      await writeFile(
        path.join(tempDir, 'cases.yml'),
        `- id: test-1
  criteria: Goal
  input: "Query"
`,
      );

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
      await writeFile(
        path.join(tempDir, 'cases.jsonl'),
        `{"id":"test-1","criteria":"Goal","input":"Query"}\n`,
      );

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

  describe('suite-level input validation', () => {
    it('validates suite-level input as string', async () => {
      const filePath = path.join(tempDir, 'suite-input-string.yaml');
      await writeFile(
        filePath,
        `input: "Shared context"
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates suite-level input as message array', async () => {
      const filePath = path.join(tempDir, 'suite-input-array.yaml');
      await writeFile(
        filePath,
        `input:
  - role: system
    content: "You are a helpful assistant."
  - role: user
    content: "Context message"
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects suite-level input with invalid type', async () => {
      const filePath = path.join(tempDir, 'suite-input-invalid.yaml');
      await writeFile(
        filePath,
        `input: 123
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("suite-level 'input'"))).toBe(true);
    });
  });

  describe('workspace repo validation', () => {
    it('warns when checkout.resolve is set for a local repo source', async () => {
      const filePath = path.join(tempDir, 'workspace-local-resolve-warning.yaml');
      await writeFile(
        filePath,
        `workspace:
  repos:
    - path: ./repo
      source:
        type: local
        path: /tmp/local-repo
      checkout:
        ref: main
        resolve: local
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(
        warnings.some(
          (e) => e.message.includes('checkout.resolve') && e.message.includes('local source'),
        ),
      ).toBe(true);
    });

    it('warns when a per-test workspace override sets checkout.resolve for a local repo source', async () => {
      const filePath = path.join(tempDir, 'workspace-local-resolve-per-test-warning.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    criteria: Goal
    input: "Query"
    workspace:
      repos:
        - path: ./repo
          source:
            type: local
            path: /tmp/local-repo
          checkout:
            ref: main
            resolve: local
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(
        warnings.some(
          (e) => e.message.includes('checkout.resolve') && e.message.includes('local source'),
        ),
      ).toBe(true);
    });

    it('warns when an inline workspace config interpolates a local repo source type', async () => {
      const originalSourceType = process.env.REPO_SOURCE_TYPE;
      process.env.REPO_SOURCE_TYPE = 'local';

      try {
        const filePath = path.join(
          tempDir,
          'workspace-local-resolve-inline-interpolated-warning.yaml',
        );
        await writeFile(
          filePath,
          `workspace:
  repos:
    - path: ./repo
      source:
        type: "\${{ REPO_SOURCE_TYPE }}"
        path: /tmp/local-repo
      checkout:
        ref: main
        resolve: local
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
        );

        const result = await validateEvalFile(filePath);

        const warnings = result.errors.filter((e) => e.severity === 'warning');
        expect(
          warnings.some(
            (e) => e.message.includes('checkout.resolve') && e.message.includes('local source'),
          ),
        ).toBe(true);
      } finally {
        if (originalSourceType === undefined) {
          Reflect.deleteProperty(process.env, 'REPO_SOURCE_TYPE');
        } else {
          process.env.REPO_SOURCE_TYPE = originalSourceType;
        }
      }
    });

    it('warns when an external workspace file sets checkout.resolve for a local repo source', async () => {
      const workspaceFile = path.join(tempDir, 'external-workspace.yaml');
      await writeFile(
        workspaceFile,
        `repos:
  - path: ./repo
    source:
      type: local
      path: /tmp/local-repo
    checkout:
      ref: main
      resolve: local
`,
      );

      const filePath = path.join(tempDir, 'workspace-local-resolve-external-warning.yaml');
      await writeFile(
        filePath,
        `workspace: ./external-workspace.yaml
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(
        warnings.some(
          (e) =>
            e.filePath === workspaceFile &&
            e.message.includes('checkout.resolve') &&
            e.message.includes('local source'),
        ),
      ).toBe(true);
    });

    it('warns when an external workspace file interpolates a local repo source type', async () => {
      const originalSourceType = process.env.REPO_SOURCE_TYPE;
      process.env.REPO_SOURCE_TYPE = 'local';

      try {
        const workspaceFile = path.join(tempDir, 'external-workspace-interpolated.yaml');
        await writeFile(
          workspaceFile,
          `repos:
  - path: ./repo
    source:
      type: "\${{ REPO_SOURCE_TYPE }}"
      path: /tmp/local-repo
    checkout:
      ref: main
      resolve: local
`,
        );

        const filePath = path.join(
          tempDir,
          'workspace-local-resolve-external-interpolated-warning.yaml',
        );
        await writeFile(
          filePath,
          `workspace: ./external-workspace-interpolated.yaml
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
        );

        const result = await validateEvalFile(filePath);

        const warnings = result.errors.filter((e) => e.severity === 'warning');
        expect(
          warnings.some(
            (e) =>
              e.filePath === workspaceFile &&
              e.message.includes('checkout.resolve') &&
              e.message.includes('local source'),
          ),
        ).toBe(true);
      } finally {
        if (originalSourceType === undefined) {
          Reflect.deleteProperty(process.env, 'REPO_SOURCE_TYPE');
        } else {
          process.env.REPO_SOURCE_TYPE = originalSourceType;
        }
      }
    });

    it('rejects a missing external workspace file', async () => {
      const filePath = path.join(tempDir, 'workspace-missing-external.yaml');
      await writeFile(
        filePath,
        `workspace: ./does-not-exist.yaml
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' && e.message.includes('Failed to load external workspace file'),
        ),
      ).toBe(true);
    });

    it('warns for suite-level workspace config when tests are loaded from an external file', async () => {
      const casesFile = path.join(tempDir, 'cases.yaml');
      await writeFile(
        casesFile,
        `- id: test-1
  criteria: Goal
  input: "Query"
`,
      );

      const filePath = path.join(tempDir, 'workspace-local-resolve-external-tests-warning.yaml');
      await writeFile(
        filePath,
        `workspace:
  repos:
    - path: ./repo
      source:
        type: local
        path: /tmp/local-repo
      checkout:
        ref: main
        resolve: local
tests: ./cases.yaml
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(
        warnings.some(
          (e) => e.message.includes('checkout.resolve') && e.message.includes('local source'),
        ),
      ).toBe(true);
    });

    it('warns for per-test workspace config when tests are loaded from an external file', async () => {
      const casesFile = path.join(tempDir, 'cases-with-workspace.yaml');
      await writeFile(
        casesFile,
        `- id: test-1
  criteria: Goal
  input: "Query"
  workspace:
    repos:
      - path: ./repo
        source:
          type: local
          path: /tmp/local-repo
        checkout:
          ref: main
          resolve: local
`,
      );

      const filePath = path.join(
        tempDir,
        'workspace-local-resolve-external-tests-per-test-warning.yaml',
      );
      await writeFile(
        filePath,
        `tests: ./cases-with-workspace.yaml
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(
        warnings.some(
          (e) => e.message.includes('checkout.resolve') && e.message.includes('local source'),
        ),
      ).toBe(true);
    });
  });

  describe('backward-compat aliases', () => {
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
