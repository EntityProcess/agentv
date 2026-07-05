import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('criteria is optional when assertions are present', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-criteria-optional-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('accepts test with vars.expected_output when an assertion consumes it', async () => {
    await writeFile(
      path.join(tempDir, 'expected-output.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: test-01
    assert:
      - type: contains
        value: "{{ expected_output }}"
    vars:
      input: sample prompt
      expected_output: sample expected output
`,
    );

    const tests = await loadTests(path.join(tempDir, 'expected-output.eval.yaml'), tempDir);
    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('test-01');
    expect(tests[0].criteria).toBe('');
    expect(tests[0].assertions?.[0]).toMatchObject({
      type: 'contains',
      value: 'sample expected output',
    });
  });

  it('accepts test with assertions only and no criteria', async () => {
    await writeFile(
      path.join(tempDir, 'assert-only.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: test-02
    assert:
      - type: llm-rubric
        value:
          - response includes sample expected output
    vars:
      input: sample prompt
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
    assert:
      - type: contains
        value: sample
`,
    );

    const tests = await loadTests(path.join(tempDir, 'missing-input.eval.yaml'), tempDir);
    expect(tests).toHaveLength(0);
  });

  it('skips test with no criteria and no assertions', async () => {
    await writeFile(
      path.join(tempDir, 'no-eval-spec.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: test-04
    vars:
      input: sample prompt
`,
    );

    const tests = await loadTests(path.join(tempDir, 'no-eval-spec.eval.yaml'), tempDir);
    expect(tests).toHaveLength(0);
  });

  it('does not treat vars.expected_output as an evaluation spec by itself', async () => {
    await writeFile(
      path.join(tempDir, 'vars-reference-only.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: test-06
    vars:
      input: sample prompt
      expected_output: sample expected output
`,
    );

    const tests = await loadTests(path.join(tempDir, 'vars-reference-only.eval.yaml'), tempDir);
    expect(tests).toHaveLength(0);
  });

  it('accepts test with criteria (original behavior)', async () => {
    await writeFile(
      path.join(tempDir, 'with-criteria.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: test-05
    criteria: responds correctly
    vars:
      input: sample prompt
`,
    );

    const tests = await loadTests(path.join(tempDir, 'with-criteria.eval.yaml'), tempDir);
    expect(tests).toHaveLength(1);
    expect(tests[0].criteria).toBe('responds correctly');
  });
});
