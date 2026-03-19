import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('suite-level input', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-suite-input-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prepends suite-level input string to each test input', async () => {
    await writeFile(
      path.join(tempDir, 'string-input.eval.yaml'),
      `input: "You are a helpful assistant."
tests:
  - id: test-1
    criteria: "Responds helpfully"
    input: "What is 2+2?"
  - id: test-2
    criteria: "Responds accurately"
    input: "What is the capital of France?"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'string-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(2);

    // Suite string input wrapped as { role: "user", content: "..." } and prepended
    expect(tests[0].input).toHaveLength(2);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'You are a helpful assistant.' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'What is 2+2?' });

    expect(tests[1].input).toHaveLength(2);
    expect(tests[1].input[0]).toEqual({ role: 'user', content: 'You are a helpful assistant.' });
    expect(tests[1].input[1]).toEqual({
      role: 'user',
      content: 'What is the capital of France?',
    });
  });

  it('prepends suite-level input message array to each test input', async () => {
    await writeFile(
      path.join(tempDir, 'array-input.eval.yaml'),
      `input:
  - role: system
    content: "You are a code reviewer."
  - role: user
    content: "Review the following code."
tests:
  - id: review-1
    criteria: "Provides code review"
    input: "function add(a, b) { return a + b; }"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'array-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(3);
    expect(tests[0].input[0]).toEqual({ role: 'system', content: 'You are a code reviewer.' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'Review the following code.' });
    expect(tests[0].input[2]).toEqual({
      role: 'user',
      content: 'function add(a, b) { return a + b; }',
    });
  });

  it('does not change test input when no suite-level input is present', async () => {
    await writeFile(
      path.join(tempDir, 'no-suite-input.eval.yaml'),
      `tests:
  - id: test-1
    criteria: "Works normally"
    input: "Hello world"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'no-suite-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(1);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Hello world' });
  });

  it('skips suite-level input when test has execution.skip_defaults: true', async () => {
    await writeFile(
      path.join(tempDir, 'skip-defaults.eval.yaml'),
      `input: "System prompt context"
tests:
  - id: with-defaults
    criteria: "Uses suite input"
    input: "Query A"
  - id: without-defaults
    criteria: "Skips suite input"
    input: "Query B"
    execution:
      skip_defaults: true
`,
    );

    const tests = await loadTests(path.join(tempDir, 'skip-defaults.eval.yaml'), tempDir);

    expect(tests).toHaveLength(2);

    // First test should have suite input prepended
    expect(tests[0].input).toHaveLength(2);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'System prompt context' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'Query A' });

    // Second test with skip_defaults should only have its own input
    expect(tests[1].input).toHaveLength(1);
    expect(tests[1].input[0]).toEqual({ role: 'user', content: 'Query B' });
  });

  it('applies suite-level input to external cases file (string path)', async () => {
    await writeFile(
      path.join(tempDir, 'ext-cases.yaml'),
      `- id: ext-1
  criteria: "External test"
  input: "External query"
`,
    );

    await writeFile(
      path.join(tempDir, 'suite-external.eval.yaml'),
      `input: "Shared context"
tests: ./ext-cases.yaml
`,
    );

    const tests = await loadTests(path.join(tempDir, 'suite-external.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(2);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Shared context' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'External query' });
  });

  it('includes suite-level input text in the question field', async () => {
    await writeFile(
      path.join(tempDir, 'question-field.eval.yaml'),
      `input: "Context: You are helpful."
tests:
  - id: question-test
    criteria: "Has combined question"
    input: "What is 2+2?"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'question-field.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    // question field should include text from both suite and test input
    expect(tests[0].question).toContain('Context: You are helpful.');
    expect(tests[0].question).toContain('What is 2+2?');
  });

  it('handles suite-level input with test-level message array input', async () => {
    await writeFile(
      path.join(tempDir, 'mixed-formats.eval.yaml'),
      `input: "Shared system context"
tests:
  - id: mixed-test
    criteria: "Handles mixed formats"
    input:
      - role: user
        content: "First user message"
      - role: assistant
        content: "I understand."
      - role: user
        content: "Follow-up question"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'mixed-formats.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(4);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Shared system context' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'First user message' });
    expect(tests[0].input[2]).toEqual({ role: 'assistant', content: 'I understand.' });
    expect(tests[0].input[3]).toEqual({ role: 'user', content: 'Follow-up question' });
  });
});
