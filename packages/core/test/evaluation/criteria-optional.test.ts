import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('criteria is optional when expected_output or assert is present', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-criteria-optional-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('accepts test with expected_output and no criteria', async () => {
    await writeFile(
      path.join(tempDir, 'expected-output.eval.yaml'),
      `tests:
  - id: test-01
    input: "sample prompt"
    expected_output: "sample expected output"
    assertions:
      - type: contains
        value: sample
`,
    );

    const tests = await loadTests(path.join(tempDir, 'expected-output.eval.yaml'), tempDir);
    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('test-01');
    expect(tests[0].criteria).toBe('');
  });

  it('accepts test with assertions only and no criteria', async () => {
    await writeFile(
      path.join(tempDir, 'assert-only.eval.yaml'),
      `tests:
  - id: test-02
    input: "sample prompt"
    assertions:
      - type: rubrics
        criteria:
          - response includes sample expected output
`,
    );

    const tests = await loadTests(path.join(tempDir, 'assert-only.eval.yaml'), tempDir);
    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('test-02');
    expect(tests[0].criteria).toBe('');
  });

  it('still requires id and input', async () => {
    await writeFile(
      path.join(tempDir, 'missing-input.eval.yaml'),
      `tests:
  - id: test-03
    assertions:
      - type: contains
        value: sample
`,
    );

    const tests = await loadTests(path.join(tempDir, 'missing-input.eval.yaml'), tempDir);
    expect(tests).toHaveLength(0);
  });

  it('skips test with no criteria, no expected_output, and no assertions', async () => {
    await writeFile(
      path.join(tempDir, 'no-eval-spec.eval.yaml'),
      `tests:
  - id: test-04
    input: "sample prompt"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'no-eval-spec.eval.yaml'), tempDir);
    expect(tests).toHaveLength(0);
  });

  it('accepts test with criteria (original behavior)', async () => {
    await writeFile(
      path.join(tempDir, 'with-criteria.eval.yaml'),
      `tests:
  - id: test-05
    input: "sample prompt"
    criteria: "responds correctly"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'with-criteria.eval.yaml'), tempDir);
    expect(tests).toHaveLength(1);
    expect(tests[0].criteria).toBe('responds correctly');
  });
});
