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

  it('expands input_files + string input to type:file + type:text content blocks', async () => {
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

    const tests = await loadTests(path.join(tempDir, 'input-files-basic.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('summarize-csv');

    // The test should have a single user message with content blocks
    expect(tests[0].input).toHaveLength(1);
    const message = tests[0].input[0];
    expect(message.role).toBe('user');

    // Content should be an array of content blocks
    const content = message.content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as Array<{ type: string; value: string }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('file');
    expect(blocks[0].value).toBe('./sales.csv');
    expect(blocks[1].type).toBe('text');
    expect(blocks[1].value).toBe('Summarize the monthly trends in this CSV.');
  });

  it('places multiple file blocks before text block', async () => {
    await writeFile(path.join(tempDir, 'b.csv'), 'month,revenue\nMar,300\n');

    await writeFile(
      path.join(tempDir, 'input-files-multi.eval.yaml'),
      `tests:
  - id: compare-csvs
    criteria: "Compares two CSV files"
    input_files:
      - ./sales.csv
      - ./b.csv
    input: "Compare these two files."
`,
    );

    const tests = await loadTests(path.join(tempDir, 'input-files-multi.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    const message = tests[0].input[0];
    const content = message.content as Array<{ type: string; value: string }>;
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({ type: 'file', value: './sales.csv' });
    expect(content[1]).toEqual({ type: 'file', value: './b.csv' });
    expect(content[2]).toEqual({ type: 'text', value: 'Compare these two files.' });
  });

  it('produces identical runtime behaviour to explicit type:file + type:text form', async () => {
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
      `tests:
  - id: explicit-form
    criteria: "Explicit form works"
    input:
      - role: user
        content:
          - type: file
            value: ./sales.csv
          - type: text
            value: "Summarize this."
`,
    );

    const [shorthandTests, explicitTests] = await Promise.all([
      loadTests(path.join(tempDir, 'input-files-shorthand.eval.yaml'), tempDir),
      loadTests(path.join(tempDir, 'input-files-explicit.eval.yaml'), tempDir),
    ]);

    expect(shorthandTests).toHaveLength(1);
    expect(explicitTests).toHaveLength(1);

    // Both forms should resolve to the same input structure
    const shorthandMsg = shorthandTests[0].input[0];
    const explicitMsg = explicitTests[0].input[0];
    expect(shorthandMsg.role).toBe(explicitMsg.role);
    expect(shorthandMsg.content).toEqual(explicitMsg.content);

    // Both should produce the same file_paths resolution
    expect(shorthandTests[0].file_paths).toEqual(explicitTests[0].file_paths);
  });

  it('merges suite-level input_files into tests with string input', async () => {
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

    const tests = await loadTests(path.join(tempDir, 'suite-input-files.eval.yaml'), tempDir);

    expect(tests).toHaveLength(2);

    // Both tests should have file blocks from suite-level input_files
    for (const test of tests) {
      expect(test.input).toHaveLength(1);
      const message = test.input[0];
      expect(message.role).toBe('user');
      const content = message.content as Array<{ type: string; value: string }>;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: 'file', value: './sales.csv' });
      expect(content[1].type).toBe('text');
    }

    // Verify per-test text is preserved
    const msg0Content = tests[0].input[0].content as Array<{ type: string; value: string }>;
    expect(msg0Content[1].value).toBe('Summarize the important constraints.');
    const msg1Content = tests[1].input[0].content as Array<{ type: string; value: string }>;
    expect(msg1Content[1].value).toBe('Analyze the revenue data.');
  });

  it('per-test input_files overrides suite-level input_files', async () => {
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

    const tests = await loadTests(
      path.join(tempDir, 'suite-input-files-override.eval.yaml'),
      tempDir,
    );

    expect(tests).toHaveLength(2);

    // First test uses suite-level input_files
    const content0 = tests[0].input[0].content as Array<{ type: string; value: string }>;
    expect(content0[0]).toEqual({ type: 'file', value: './sales.csv' });

    // Second test uses its own input_files (overrides suite-level)
    const content1 = tests[1].input[0].content as Array<{ type: string; value: string }>;
    expect(content1[0]).toEqual({ type: 'file', value: './override.csv' });
    expect(content1).toHaveLength(2); // only override.csv + text, not sales.csv
  });

  it('suite-level input_files with multiple files prepends all file blocks', async () => {
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

    const tests = await loadTests(path.join(tempDir, 'suite-multi-files.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    const content = tests[0].input[0].content as Array<{ type: string; value: string }>;
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({ type: 'file', value: './sales.csv' });
    expect(content[1]).toEqual({ type: 'file', value: './schema.json' });
    expect(content[2]).toEqual({ type: 'text', value: 'Summarize the constraints.' });
  });

  it('suite-level input_files is skipped when skip_defaults is true', async () => {
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

    const tests = await loadTests(path.join(tempDir, 'suite-skip-defaults.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    // Should be plain string input, not expanded with file blocks
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Plain question.' });
  });

  it('is skipped and falls back to plain input when input_files is absent', async () => {
    await writeFile(
      path.join(tempDir, 'no-input-files.eval.yaml'),
      `tests:
  - id: plain-input
    criteria: "Uses plain string input"
    input: "What is 2+2?"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'no-input-files.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'What is 2+2?' });
  });
});
