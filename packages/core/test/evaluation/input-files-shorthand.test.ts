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
