import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('input_files shorthand', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-input-files-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    // Create a dummy fixture file for file resolution tests
    await writeFile(path.join(tempDir, 'sales.csv'), 'month,revenue\nJan,100\nFeb,200\n');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects input_files combined with authored tests[].input', async () => {
    await writeFile(
      path.join(tempDir, 'input-files-basic.eval.yaml'),
      `tests:
  - id: summarize-csv
    criteria: "Summarizes monthly trends"
    input_files:
      - ./sales.csv
    input: "Summarize the monthly trends in this CSV."
`,
    );

    await expect(
      loadTests(path.join(tempDir, 'input-files-basic.eval.yaml'), tempDir),
    ).rejects.toThrow(/tests\[0\]\.input has been removed.*top-level 'prompts'.*tests\[\]\.vars/);
  });

  it('renders canonical prompt content blocks with file vars', async () => {
    await writeFile(path.join(tempDir, 'b.csv'), 'month,revenue\nMar,300\n');

    await writeFile(
      path.join(tempDir, 'input-files-multi.eval.yaml'),
      `prompts:
  - - role: user
      content:
        - type: file
          value: "{{ first_file }}"
        - type: file
          value: "{{ second_file }}"
        - type: text
          value: "{{ instruction }}"
tests:
  - id: compare-csvs
    criteria: "Compares two CSV files"
    vars:
      first_file: ./sales.csv
      second_file: ./b.csv
      instruction: Compare these two files.
`,
    );

    const tests = await loadTests(path.join(tempDir, 'input-files-multi.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    const message = tests[0].input[0];
    const content = message.content as Array<{ type: string; value: string }>;
    expect(content).toHaveLength(3);
    expect(content[0]).toMatchObject({ type: 'file', value: './sales.csv' });
    expect(content[1]).toMatchObject({ type: 'file', value: './b.csv' });
    expect(content[2]).toEqual({ type: 'text', value: 'Compare these two files.' });
  });

  it('rejects deprecated input_files + input instead of treating it like explicit prompt content', async () => {
    await writeFile(
      path.join(tempDir, 'input-files-shorthand.eval.yaml'),
      `tests:
  - id: shorthand-form
    criteria: "Shorthand form works"
    input_files:
      - ./sales.csv
    input: "Summarize this."
`,
    );

    await writeFile(
      path.join(tempDir, 'input-files-explicit.eval.yaml'),
      `prompts:
  - - role: user
      content:
        - type: file
          value: ./sales.csv
        - type: text
          value: "Summarize this."
tests:
  - id: explicit-form
    criteria: "Explicit form works"
`,
    );

    await expect(
      loadTests(path.join(tempDir, 'input-files-shorthand.eval.yaml'), tempDir),
    ).rejects.toThrow(/tests\[0\]\.input has been removed/);

    const explicitTests = await loadTests(
      path.join(tempDir, 'input-files-explicit.eval.yaml'),
      tempDir,
    );
    expect(explicitTests).toHaveLength(1);
    const explicitMsg = explicitTests[0].input[0];
    expect(explicitMsg.content).toMatchObject([
      { type: 'file', value: './sales.csv' },
      { type: 'text', value: 'Summarize this.' },
    ]);
  });

  it('rejects suite-level input_files with authored string inputs', async () => {
    await writeFile(
      path.join(tempDir, 'suite-input-files.eval.yaml'),
      `description: Suite-level input_files test
input_files:
  - ./sales.csv
tests:
  - id: summarize
    criteria: "Summarizes monthly trends"
    input: "Summarize the important constraints."
  - id: analyze
    criteria: "Analyzes data"
    input: "Analyze the revenue data."
`,
    );

    await expect(
      loadTests(path.join(tempDir, 'suite-input-files.eval.yaml'), tempDir),
    ).rejects.toThrow(/tests\[0\]\.input has been removed/);
  });

  it('rejects per-test input_files with authored string inputs', async () => {
    await writeFile(path.join(tempDir, 'override.csv'), 'override data');

    await writeFile(
      path.join(tempDir, 'suite-input-files-override.eval.yaml'),
      `input_files:
  - ./sales.csv
tests:
  - id: uses-suite
    criteria: "Uses suite files"
    input: "Check the data."
  - id: uses-own
    criteria: "Uses own files"
    input_files:
      - ./override.csv
    input: "Check the override data."
`,
    );

    await expect(
      loadTests(path.join(tempDir, 'suite-input-files-override.eval.yaml'), tempDir),
    ).rejects.toThrow(/tests\[0\]\.input has been removed/);
  });

  it('rejects suite-level input_files with authored input even with multiple files', async () => {
    await writeFile(path.join(tempDir, 'schema.json'), '{"type": "object"}');

    await writeFile(
      path.join(tempDir, 'suite-multi-files.eval.yaml'),
      `input_files:
  - ./sales.csv
  - ./schema.json
tests:
  - id: multi-file-test
    criteria: "Processes multiple files"
    input: "Summarize the constraints."
`,
    );

    await expect(
      loadTests(path.join(tempDir, 'suite-multi-files.eval.yaml'), tempDir),
    ).rejects.toThrow(/tests\[0\]\.input has been removed/);
  });

  it('rejects authored input even when skip_defaults is true', async () => {
    await writeFile(
      path.join(tempDir, 'suite-skip-defaults.eval.yaml'),
      `input_files:
  - ./sales.csv
tests:
  - id: no-suite-files
    criteria: "Skips suite files"
    input: "Plain question."
    execution:
      skip_defaults: true
`,
    );

    await expect(
      loadTests(path.join(tempDir, 'suite-skip-defaults.eval.yaml'), tempDir),
    ).rejects.toThrow(/tests\[0\]\.input has been removed/);
  });

  it('rejects authored input when input_files is absent', async () => {
    await writeFile(
      path.join(tempDir, 'no-input-files.eval.yaml'),
      `tests:
  - id: plain-input
    criteria: "Uses plain string input"
    input: "What is 2+2?"
`,
    );

    await expect(
      loadTests(path.join(tempDir, 'no-input-files.eval.yaml'), tempDir),
    ).rejects.toThrow(/tests\[0\]\.input has been removed/);
  });

  it('uses a sibling PROMPT.md when input is omitted', async () => {
    const evalDir = path.join(tempDir, 'sibling-prompt');
    await mkdir(evalDir, { recursive: true });
    await writeFile(path.join(evalDir, 'PROMPT.md'), 'Use the sibling prompt.\n');
    await writeFile(
      path.join(evalDir, 'EVAL.yaml'),
      `tests:
  - id: sibling-prompt
    criteria: "Uses the prompt file"
`,
    );

    const tests = await loadTests(path.join(evalDir, 'EVAL.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Use the sibling prompt.\n' });
    expect(tests[0].question).toBe('Use the sibling prompt.');
  });

  it('uses PROMPT.md from input_files without duplicating it as an attachment', async () => {
    const evalDir = path.join(tempDir, 'input-files-prompt');
    await mkdir(path.join(evalDir, 'task'), { recursive: true });
    await writeFile(
      path.join(evalDir, 'task', 'PROMPT.md'),
      'Summarize the attached sales data.\n',
    );
    await writeFile(path.join(evalDir, 'sales.csv'), 'month,revenue\nApr,400\n');
    await writeFile(
      path.join(evalDir, 'EVAL.yaml'),
      `tests:
  - id: prompt-file-with-attachment
    criteria: "Uses the prompt and attached data"
    input_files:
      - ./task/PROMPT.md
      - ./sales.csv
`,
    );

    const tests = await loadTests(path.join(evalDir, 'EVAL.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    const content = tests[0].input[0].content as Array<{ type: string; value: string }>;
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({ type: 'file', value: './sales.csv' });
    expect(content[1]).toEqual({ type: 'text', value: 'Summarize the attached sales data.\n' });
    expect(tests[0].file_paths).toHaveLength(1);
    expect(tests[0].file_paths[0]).toContain('sales.csv');
  });
});
