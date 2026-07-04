import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('prompt input authoring', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-prompt-input-authoring-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects top-level input in authored eval YAML', async () => {
    const filePath = path.join(tempDir, 'top-level-input.eval.yaml');
    await writeFile(
      filePath,
      `input: Answer briefly.
tests:
  - id: case-1
    assert:
      - type: contains
        value: ok
`,
    );

    await expect(loadTests(filePath, tempDir)).rejects.toThrow(
      /Top-level 'input' has been removed.*top-level 'prompts'.*default_test\.vars.*tests\[\]\.vars/,
    );
  });

  it('rejects tests[].input in authored eval YAML', async () => {
    const filePath = path.join(tempDir, 'test-input.eval.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: case-1
    input: Answer briefly.
    assert:
      - type: contains
        value: ok
`,
    );

    await expect(loadTests(filePath, tempDir)).rejects.toThrow(
      /tests\[0\]\.input has been removed.*top-level 'prompts'.*tests\[\]\.vars/,
    );
  });

  it('renders chat prompt entries with default_test.vars and tests[].vars', async () => {
    const filePath = path.join(tempDir, 'prompt-vars.eval.yaml');
    await writeFile(
      filePath,
      `prompts:
  - - role: system
      content: "Answer in {{ tone }} style."
    - role: user
      content: "{{ question }}"
default_test:
  vars:
    tone: concise
tests:
  - id: refund
    vars:
      question: Can a damaged final-sale item be refunded?
    assert:
      - type: contains
        value: refund
`,
    );

    const tests = await loadTests(filePath, tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toEqual([
      { role: 'system', content: 'Answer in concise style.' },
      { role: 'user', content: 'Can a damaged final-sale item be refunded?' },
    ]);
    expect(tests[0].prompt).toMatchObject({ kind: 'chat' });
  });

  it('keeps external raw-case input scoped outside authored eval YAML', async () => {
    await writeFile(
      path.join(tempDir, 'raw-cases.yaml'),
      `- id: raw-case-1
  input: Raw case prompt text.
  assert:
    - type: contains
      value: raw
`,
    );
    const filePath = path.join(tempDir, 'raw-case-import.eval.yaml');
    await writeFile(filePath, 'tests: file://raw-cases.yaml\n');

    const tests = await loadTests(filePath, tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toEqual([{ role: 'user', content: 'Raw case prompt text.' }]);
    expect(tests[0].source?.testSnapshotYaml).toContain('input: Raw case prompt text.');
  });
});
