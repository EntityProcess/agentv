import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type CodeJudgeInput, CodeJudgeInputSchema } from '../src/schemas.js';

describe('CodeJudgeInputSchema with outputPath', () => {
  const validInput = {
    question: 'What is 2+2?',
    criteria: 'The answer should be 4',
    expectedOutput: [{ role: 'assistant', content: '4' }],
    answer: 'The answer is 4',
    guidelineFiles: [],
    inputFiles: [],
    input: [{ role: 'user', content: 'What is 2+2?' }],
  };

  it('accepts outputPath as optional string', () => {
    const inputWithPath = {
      ...validInput,
      outputPath: '/tmp/test/output.json',
      output: null,
    };
    const result = CodeJudgeInputSchema.parse(inputWithPath);
    expect(result.outputPath).toBe('/tmp/test/output.json');
    expect(result.output).toBeNull();
  });

  it('allows outputPath to be omitted (backward compat)', () => {
    const result = CodeJudgeInputSchema.parse(validInput);
    expect(result.outputPath).toBeUndefined();
  });

  it('allows both output and outputPath to be omitted', () => {
    const result = CodeJudgeInputSchema.parse(validInput);
    expect(result.output).toBeUndefined();
    expect(result.outputPath).toBeUndefined();
  });
});

describe('Lazy file-backed output loading', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'eval-lazy-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lazily loads output from file when outputPath is set', () => {
    const messages = [
      { role: 'assistant', content: 'Hello from file' },
      { role: 'user', content: 'Test' },
    ];
    const filePath = join(tmpDir, 'output.json');
    writeFileSync(filePath, JSON.stringify(messages));

    const input: CodeJudgeInput = CodeJudgeInputSchema.parse({
      question: 'test',
      criteria: 'test',
      expectedOutput: [],
      answer: 'test',
      output: null,
      outputPath: filePath,
      guidelineFiles: [],
      inputFiles: [],
      input: [],
    });

    // Set up lazy loading (simulates what runtime.ts does)
    let cachedOutput: CodeJudgeInput['output'] | undefined;
    Object.defineProperty(input, 'output', {
      get() {
        if (cachedOutput === undefined) {
          cachedOutput = JSON.parse(readFileSync(filePath, 'utf8'));
        }
        return cachedOutput;
      },
      configurable: true,
      enumerable: true,
    });

    // First access triggers file read
    const output = input.output;
    expect(output).toHaveLength(2);
    expect(output?.[0].content).toBe('Hello from file');

    // Second access uses cache
    const output2 = input.output;
    expect(output2).toBe(output); // same reference
  });

  it('uses inline output when outputPath is absent', () => {
    const input: CodeJudgeInput = CodeJudgeInputSchema.parse({
      question: 'test',
      criteria: 'test',
      expectedOutput: [],
      answer: 'test',
      output: [{ role: 'assistant', content: 'inline' }],
      guidelineFiles: [],
      inputFiles: [],
      input: [],
    });

    // No lazy loading needed — output is already present
    expect(input.output).toHaveLength(1);
    expect(input.output?.[0].content).toBe('inline');
  });
});
