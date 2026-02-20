import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { EvaluationResult } from '@agentv/core';

import { JsonWriter } from '../../../src/commands/eval/json-writer.js';
import { JunitWriter, escapeXml } from '../../../src/commands/eval/junit-writer.js';
import {
  createMultiWriter,
  createWriterFromPath,
} from '../../../src/commands/eval/output-writer.js';

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    testId: 'test-1',
    score: 1.0,
    hits: ['criterion-1'],
    misses: [],
    candidateAnswer: 'answer',
    target: 'default',
    ...overrides,
  };
}

describe('JsonWriter', () => {
  const testDir = path.join(import.meta.dir, '.test-json-output');
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = path.join(testDir, `results-${Date.now()}.json`);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('should write aggregate JSON with stats and results', async () => {
    const writer = await JsonWriter.open(testFilePath);

    await writer.append(makeResult({ testId: 'pass-1', score: 0.9 }));
    await writer.append(makeResult({ testId: 'pass-2', score: 0.7 }));
    await writer.append(makeResult({ testId: 'fail-1', score: 0.3 }));
    await writer.close();

    const content = JSON.parse(await readFile(testFilePath, 'utf8'));
    expect(content.stats.total).toBe(3);
    expect(content.stats.passed).toBe(2);
    expect(content.stats.failed).toBe(1);
    expect(content.stats.pass_rate).toBeCloseTo(2 / 3);
    expect(content.results).toHaveLength(3);
    expect(content.results[0].test_id).toBe('pass-1');
  });

  it('should handle empty results', async () => {
    const writer = await JsonWriter.open(testFilePath);
    await writer.close();

    const content = JSON.parse(await readFile(testFilePath, 'utf8'));
    expect(content.stats.total).toBe(0);
    expect(content.stats.passed).toBe(0);
    expect(content.stats.failed).toBe(0);
    expect(content.stats.pass_rate).toBe(0);
    expect(content.results).toHaveLength(0);
  });

  it('should throw when writing to closed writer', async () => {
    const writer = await JsonWriter.open(testFilePath);
    await writer.close();

    await expect(writer.append(makeResult())).rejects.toThrow('Cannot write to closed JSON writer');
  });

  it('should be idempotent on close', async () => {
    const writer = await JsonWriter.open(testFilePath);
    await writer.append(makeResult());
    await writer.close();
    await writer.close(); // Should not throw
  });

  it('should convert keys to snake_case', async () => {
    const writer = await JsonWriter.open(testFilePath);
    await writer.append(makeResult({ candidateAnswer: 'my answer', testId: 'snake-case-test' }));
    await writer.close();

    const content = JSON.parse(await readFile(testFilePath, 'utf8'));
    expect(content.results[0].candidate_answer).toBe('my answer');
    expect(content.results[0].test_id).toBe('snake-case-test');
  });
});

describe('JunitWriter', () => {
  const testDir = path.join(import.meta.dir, '.test-junit-output');
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = path.join(testDir, `results-${Date.now()}.xml`);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('should write valid JUnit XML structure', async () => {
    const writer = await JunitWriter.open(testFilePath);

    await writer.append(makeResult({ testId: 'pass-1', score: 0.9 }));
    await writer.append(makeResult({ testId: 'fail-1', score: 0.3, reasoning: 'Too low' }));
    await writer.close();

    const xml = await readFile(testFilePath, 'utf8');
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<testsuites tests="2" failures="1" errors="0">');
    expect(xml).toContain('<testcase name="pass-1"');
    expect(xml).toContain('<testcase name="fail-1"');
    expect(xml).toContain('<failure');
    expect(xml).toContain('score=0.300');
    expect(xml).toContain('Too low');
  });

  it('should group results by dataset as testsuites', async () => {
    const writer = await JunitWriter.open(testFilePath);

    await writer.append(makeResult({ testId: 'a-1', dataset: 'suite-a', score: 1.0 }));
    await writer.append(makeResult({ testId: 'a-2', dataset: 'suite-a', score: 0.8 }));
    await writer.append(makeResult({ testId: 'b-1', dataset: 'suite-b', score: 0.5 }));
    await writer.close();

    const xml = await readFile(testFilePath, 'utf8');
    expect(xml).toContain('testsuite name="suite-a" tests="2"');
    expect(xml).toContain('testsuite name="suite-b" tests="1"');
  });

  it('should use default suite name when no dataset', async () => {
    const writer = await JunitWriter.open(testFilePath);
    await writer.append(makeResult({ testId: 'test-1', score: 1.0 }));
    await writer.close();

    const xml = await readFile(testFilePath, 'utf8');
    expect(xml).toContain('testsuite name="default"');
  });

  it('should handle errors as <error> elements', async () => {
    const writer = await JunitWriter.open(testFilePath);
    await writer.append(makeResult({ testId: 'err-1', score: 0, error: 'Timeout exceeded' }));
    await writer.close();

    const xml = await readFile(testFilePath, 'utf8');
    expect(xml).toContain('<error message="Timeout exceeded"');
    expect(xml).toContain('errors="1"');
  });

  it('should throw when writing to closed writer', async () => {
    const writer = await JunitWriter.open(testFilePath);
    await writer.close();

    await expect(writer.append(makeResult())).rejects.toThrow(
      'Cannot write to closed JUnit writer',
    );
  });
});

describe('escapeXml', () => {
  it('should escape ampersands', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });

  it('should escape angle brackets', () => {
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
  });

  it('should escape quotes', () => {
    expect(escapeXml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('should escape apostrophes', () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('should handle all entities combined', () => {
    expect(escapeXml('<a & "b" \'c\'>')).toBe('&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;');
  });

  it('should return empty string unchanged', () => {
    expect(escapeXml('')).toBe('');
  });

  it('should return plain text unchanged', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });
});

describe('createWriterFromPath', () => {
  const testDir = path.join(import.meta.dir, '.test-writer-dispatch');

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('should create JsonlWriter for .jsonl extension', async () => {
    const writer = await createWriterFromPath(path.join(testDir, 'out.jsonl'));
    expect(writer).toBeDefined();
    await writer.close();
  });

  it('should create JsonWriter for .json extension', async () => {
    const writer = await createWriterFromPath(path.join(testDir, 'out.json'));
    expect(writer).toBeDefined();
    await writer.close();
  });

  it('should create JunitWriter for .xml extension', async () => {
    const writer = await createWriterFromPath(path.join(testDir, 'out.xml'));
    expect(writer).toBeDefined();
    await writer.close();
  });

  it('should create YamlWriter for .yaml extension', async () => {
    const writer = await createWriterFromPath(path.join(testDir, 'out.yaml'));
    expect(writer).toBeDefined();
    await writer.close();
  });

  it('should throw for unsupported extension', () => {
    expect(() => createWriterFromPath(path.join(testDir, 'out.csv'))).toThrow(
      'Unsupported output file extension ".csv"',
    );
  });
});

describe('createMultiWriter', () => {
  const testDir = path.join(import.meta.dir, '.test-multi-writer');

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('should write to multiple output files simultaneously', async () => {
    const jsonlPath = path.join(testDir, 'results.jsonl');
    const jsonPath = path.join(testDir, 'results.json');
    const xmlPath = path.join(testDir, 'results.xml');

    const writer = await createMultiWriter([jsonlPath, jsonPath, xmlPath]);

    await writer.append(makeResult({ testId: 'multi-1', score: 0.9 }));
    await writer.append(makeResult({ testId: 'multi-2', score: 0.3 }));
    await writer.close();

    // Verify JSONL
    const jsonlContent = await readFile(jsonlPath, 'utf8');
    const jsonlLines = jsonlContent.trim().split('\n');
    expect(jsonlLines).toHaveLength(2);
    expect(JSON.parse(jsonlLines[0]).test_id).toBe('multi-1');

    // Verify JSON
    const jsonContent = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(jsonContent.stats.total).toBe(2);
    expect(jsonContent.stats.passed).toBe(1);
    expect(jsonContent.stats.failed).toBe(1);
    expect(jsonContent.results).toHaveLength(2);

    // Verify XML
    const xmlContent = await readFile(xmlPath, 'utf8');
    expect(xmlContent).toContain('<testsuites tests="2" failures="1"');
    expect(xmlContent).toContain('<testcase name="multi-1"');
    expect(xmlContent).toContain('<testcase name="multi-2"');
  });
});
