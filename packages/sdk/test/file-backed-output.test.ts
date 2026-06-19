import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type CodeGraderInput, CodeGraderInputSchema } from '../src/schemas.js';

describe('CodeGraderInputSchema with outputPath', () => {
  const validInput = {
    criteria: 'The answer should be 4',
    expectedOutput: [{ role: 'assistant', content: '4' }],
    inputFiles: [],
    input: [{ role: 'user', content: 'What is 2+2?' }],
  };

  it('accepts outputPath as optional string', () => {
    const inputWithPath = {
      ...validInput,
      outputPath: '/tmp/test/output.json',
      output: null,
    };
    const result = CodeGraderInputSchema.parse(inputWithPath);
    expect(result.outputPath).toBe('/tmp/test/output.json');
    expect(result.output).toBeNull();
  });

  it('allows outputPath to be omitted (backward compat)', () => {
    const result = CodeGraderInputSchema.parse(validInput);
    expect(result.outputPath).toBeUndefined();
  });

  it('allows both output and outputPath to be omitted', () => {
    const result = CodeGraderInputSchema.parse(validInput);
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
    const answer = 'Hello from file';
    const filePath = join(tmpDir, 'output.json');
    writeFileSync(filePath, JSON.stringify(answer));

    const input: CodeGraderInput = CodeGraderInputSchema.parse({
      criteria: 'test',
      expectedOutput: [],
      output: null,
      outputPath: filePath,
      inputFiles: [],
      input: [],
    });

    // Set up lazy loading (simulates what runtime.ts does)
    let cachedOutput: CodeGraderInput['output'] | undefined;
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
    expect(output).toBe('Hello from file');

    // Second access uses cache
    const output2 = input.output;
    expect(output2).toBe(output); // same reference
  });

  it('uses inline output when outputPath is absent', () => {
    const input: CodeGraderInput = CodeGraderInputSchema.parse({
      criteria: 'test',
      expectedOutput: [],
      output: 'inline',
      inputFiles: [],
      input: [],
    });

    // No lazy loading needed — output is already present
    expect(input.output).toBe('inline');
  });
});
