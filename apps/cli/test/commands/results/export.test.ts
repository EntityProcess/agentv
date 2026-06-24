import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  GradingArtifact,
  IndexArtifactEntry,
  RunSummaryArtifact,
} from '../../../src/commands/eval/artifact-writer.js';
import { parseJsonlResults } from '../../../src/commands/eval/artifact-writer.js';
import {
  buildProjectionBundleFromExportedIndex,
  deriveExportRunId,
  deriveOutputDir,
  exportResults,
  loadExportSource,
} from '../../../src/commands/results/export.js';
import {
  buildProjectionBundle,
  serializeProjectionBundle,
} from '../../../src/commands/results/projection-bundle.js';

// ── Sample JSONL content (snake_case, matching on-disk format) ──────────

const RESULT_FULL = {
  timestamp: '2026-03-18T10:00:01.000Z',
  test_id: 'test-greeting',
  suite: 'demo',
  score: 1.0,
  assertions: [
    { text: 'Says hello', passed: true },
    { text: 'Uses name', passed: true },
  ],
  output: 'Hello, Alice!',
  target: 'gpt-4o',
  scores: [
    {
      name: 'greeting_quality',
      type: 'llm-grader',
      score: 1.0,
      assertions: [{ text: 'Says hello', passed: true }],
    },
  ],
  duration_ms: 3500,
  token_usage: { input: 1000, output: 500 },
  cost_usd: 0.015,
};

const RESULT_PARTIAL = {
  timestamp: '2026-03-18T10:00:05.000Z',
  test_id: 'test-math',
  suite: 'demo',
  score: 0.5,
  assertions: [
    { text: 'Correct formula', passed: true },
    { text: 'Wrong answer', passed: false },
  ],
  target: 'gpt-4o',
  scores: [
    {
      name: 'math_accuracy',
      type: 'contains',
      score: 0.5,
      assertions: [
        { text: 'Correct formula', passed: true },
        { text: 'Wrong answer', passed: false },
      ],
    },
  ],
  duration_ms: 1200,
  token_usage: { input: 200, output: 100 },
  cost_usd: 0.003,
};

const RESULT_DIFFERENT_TARGET = {
  timestamp: '2026-03-18T10:00:10.000Z',
  test_id: 'test-greeting',
  suite: 'demo',
  score: 0.75,
  assertions: [
    { text: 'Says hello', passed: true },
    { text: 'Missing name', passed: false },
  ],
  target: 'claude-sonnet',
  duration_ms: 2000,
  token_usage: { input: 800, output: 400 },
  cost_usd: 0.01,
};

const RESULT_NO_TRACE = {
  timestamp: '2026-03-18T10:00:15.000Z',
  test_id: 'test-simple',
  suite: 'demo',
  score: 1.0,
  assertions: [{ text: 'Correct', passed: true }],
  output: 'Yes.',
  target: 'default',
  token_usage: { input: 50, output: 20 },
  cost_usd: 0.001,
  duration_ms: 500,
};

const RESULT_WITH_RAW_PAYLOADS = {
  timestamp: '2026-03-18T10:00:20.000Z',
  test_id: 'test-private',
  suite: 'privacy',
  score: 0.25,
  assertions: [
    {
      text: 'Avoids private content',
      passed: false,
      evidence: 'SECRET_ASSERTION_EVIDENCE',
    },
  ],
  output: 'SECRET_FINAL_OUTPUT',
  target: 'codex',
  input: [{ role: 'user', content: 'SECRET_PROMPT_TEXT' }],
  scores: [
    {
      name: 'privacy_review',
      type: 'llm-grader',
      score: 0.25,
      assertions: [
        {
          text: 'Avoids private content',
          passed: false,
          evidence: 'SECRET_SCORE_EVIDENCE',
        },
      ],
      details: { excerpt: 'SECRET_SCORE_DETAILS' },
    },
  ],
  execution_status: 'quality_failure',
  duration_ms: 900,
  trace: {
    messages: [
      { role: 'user', content: 'SECRET_PROMPT_TEXT' },
      {
        role: 'assistant',
        content: 'SECRET_FINAL_OUTPUT',
        tool_calls: [
          {
            id: 'tool-call-1',
            tool: 'shell',
            input: { command: 'cat SECRET_TOOL_ARGUMENTS' },
            output: 'SECRET_TOOL_RESULT',
            status: 'ok',
          },
        ],
      },
    ],
    events: [],
    event_count: 2,
    tool_calls: { shell: 1 },
    error_count: 0,
    llm_call_count: 1,
  },
};

function toJsonl(...records: object[]): string {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

function artifactDir(outputDir: string, record: { suite?: string; test_id?: string }): string {
  const testId = record.test_id ?? 'unknown';
  return path.join(outputDir, ...(record.suite ? [record.suite] : []), testId);
}

function runDir(outputDir: string, record: { suite?: string; test_id?: string }): string {
  return path.join(artifactDir(outputDir, record), 'run-1');
}

function readIndex(outputDir: string): IndexArtifactEntry[] {
  return readFileSync(path.join(outputDir, 'index.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IndexArtifactEntry);
}

function readAnswer(outputDir: string, record: { suite?: string; test_id?: string }): string {
  return readFileSync(path.join(runDir(outputDir, record), 'outputs', 'answer.md'), 'utf8');
}

describe('results export', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-export-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loadExportSource resolves run workspaces to index.jsonl', async () => {
    const runDir = path.join(tempDir, '2026-03-18T10-00-00-000Z');
    mkdirSync(runDir, { recursive: true });
    const sourceFile = path.join(runDir, 'index.jsonl');
    writeFileSync(sourceFile, toJsonl(RESULT_FULL));

    const { sourceFile: loadedSource, results } = await loadExportSource(runDir, tempDir);

    expect(loadedSource).toBe(sourceFile);
    expect(results).toHaveLength(1);
    expect(results[0].testId).toBe('test-greeting');
  });

  it('deriveOutputDir uses the run directory name for manifest inputs', () => {
    const outputDir = deriveOutputDir(
      tempDir,
      path.join(tempDir, '2026-03-18T10-00-00-000Z', 'index.jsonl'),
    );
    expect(outputDir).toBe(
      path.join(tempDir, '.agentv', 'results', 'export', '2026-03-18T10-00-00-000Z'),
    );
  });

  it('deriveOutputDir preserves experiment directories for canonical nested runs', () => {
    const outputDir = deriveOutputDir(
      tempDir,
      path.join(
        tempDir,
        '.agentv',
        'results',
        'with-skills',
        '2026-03-18T10-00-00-000Z',
        'index.jsonl',
      ),
    );
    expect(outputDir).toBe(
      path.join(tempDir, '.agentv', 'results', 'export', 'with-skills', '2026-03-18T10-00-00-000Z'),
    );
  });

  it('deriveOutputDir rejects non-manifest paths', () => {
    expect(() => deriveOutputDir(tempDir, path.join(tempDir, 'results.jsonl'))).toThrow(
      'Expected a run manifest named index.jsonl',
    );
  });

  it('deriveExportRunId keeps retry identity tied to the source run', () => {
    expect(
      deriveExportRunId(
        path.join(tempDir, '.agentv', 'results', 'demo', '2026-run', 'index.jsonl'),
      ),
    ).toBe('2026-run');
    expect(deriveExportRunId(path.join(tempDir, 'legacy-results.jsonl'))).toBe('legacy-results');
  });

  it('builds deterministic metadata-only projection bundle output for dry-run use', () => {
    const sourceFile = path.join(tempDir, 'runs', 'privacy-run', 'index.jsonl');
    const [result] = parseJsonlResults(toJsonl(RESULT_WITH_RAW_PAYLOADS));

    const first = buildProjectionBundle([result], {
      sourceFile,
      runId: 'privacy-run',
      cwd: tempDir,
      duplicatePolicy: 'update',
    });
    const second = buildProjectionBundle([result], {
      sourceFile,
      runId: 'privacy-run',
      cwd: tempDir,
      duplicatePolicy: 'update',
    });
    const serialized = serializeProjectionBundle(first);

    expect(serialized).toBe(serializeProjectionBundle(second));
    expect(first.content_policy).toMatchObject({
      raw_content: 'excluded',
      raw_content_opt_in: false,
      default_capture: 'metadata',
    });
    expect(first.entries[0].artifact_refs).toMatchObject({
      status: 'planned_export',
    });
    expect(first.entries[0].artifact_refs).not.toHaveProperty('input_path');
    expect(first.entries[0].artifact_refs).not.toHaveProperty('output_path');
    expect(first.entries[0].artifact_refs).not.toHaveProperty('answer_path');
    expect(first.entries[0].artifact_refs).not.toHaveProperty('response_path');
    expect(first.entries[0].artifact_refs).not.toHaveProperty('transcript_path');
    expect(first.entries[0].artifact_refs).not.toHaveProperty('trace_path');
    expect(first.entries[0].feedback).not.toHaveProperty('grading_path');
    expect(first.entries[0].trace).not.toHaveProperty('envelope_ref');
    expect(first.entries[0].trace_envelope).not.toHaveProperty('artifacts');
    expect(first.entries[0].projection_identity.dimensions.run_id).toBe('privacy-run');
    expect(first.entries[0].trace_envelope.trace.spans.length).toBeGreaterThan(0);
    expect(first.entries[0].feedback.scores?.[0]).not.toHaveProperty('evidence');
    expect(serialized).not.toContain('SECRET_PROMPT_TEXT');
    expect(serialized).not.toContain('SECRET_FINAL_OUTPUT');
    expect(serialized).not.toContain('SECRET_TOOL_ARGUMENTS');
    expect(serialized).not.toContain('SECRET_TOOL_RESULT');
    expect(serialized).not.toContain('SECRET_SCORE_EVIDENCE');
  });

  it('builds projection bundles when grader scores omit assertion arrays', () => {
    const sourceFile = path.join(tempDir, 'runs', 'legacy-grader-run', 'index.jsonl');
    const [result] = parseJsonlResults(
      toJsonl({
        ...RESULT_FULL,
        scores: [
          {
            name: 'legacy_grader',
            type: 'llm-grader',
            score: 1,
          },
        ],
      }),
    );

    const bundle = buildProjectionBundle([result], {
      sourceFile,
      runId: 'legacy-grader-run',
      cwd: tempDir,
    });

    expect(bundle.entries[0].feedback.scores?.[0]).toMatchObject({
      name: 'legacy_grader',
      type: 'llm-grader',
      score: 1,
    });
    expect(bundle.entries[0].trace_envelope.scores?.[0]).toMatchObject({
      name: 'legacy_grader',
      type: 'llm-grader',
      score: 1,
    });
  });

  it('includes raw prompt, output, tool payloads, and score evidence only with opt-in', () => {
    const sourceFile = path.join(tempDir, 'runs', 'privacy-run', 'index.jsonl');
    const [result] = parseJsonlResults(toJsonl(RESULT_WITH_RAW_PAYLOADS));

    const bundle = buildProjectionBundle([result], {
      sourceFile,
      runId: 'privacy-run',
      cwd: tempDir,
      includeRawContent: true,
    });
    const serialized = serializeProjectionBundle(bundle);

    expect(bundle.content_policy).toMatchObject({
      raw_content: 'included',
      raw_content_opt_in: true,
      default_capture: 'full',
    });
    expect(bundle.entries[0].capture).toMatchObject({
      content: 'full',
      redaction_level: 'none',
    });
    expect(bundle.entries[0].artifact_refs).toMatchObject({
      status: 'planned_export',
      output_path: 'privacy/test-private/run-1/outputs/answer.md',
      answer_path: 'privacy/test-private/run-1/outputs/answer.md',
      summary_path: 'privacy/test-private/summary.json',
      trace_path: 'privacy/test-private/trace.json',
      transcript_path: 'privacy/test-private/run-1/transcript-raw.jsonl',
    });
    expect(bundle.entries[0].artifact_refs).not.toHaveProperty('input_path');
    expect(bundle.entries[0].trace.envelope_ref).toBe('privacy/test-private/trace.json');
    expect(bundle.entries[0].trace_envelope.artifacts).toBeDefined();
    expect(bundle.entries[0].feedback.grading_path).toBe('privacy/test-private/run-1/grading.json');
    expect(bundle.entries[0].raw_content).toBeDefined();
    expect(bundle.entries[0].feedback.scores?.[0]).toHaveProperty('evidence');
    expect(serialized).toContain('SECRET_PROMPT_TEXT');
    expect(serialized).toContain('SECRET_FINAL_OUTPUT');
    expect(serialized).toContain('SECRET_TOOL_ARGUMENTS');
    expect(serialized).toContain('SECRET_TOOL_RESULT');
    expect(serialized).toContain('SECRET_SCORE_EVIDENCE');
  });

  it('should create summary.json matching artifact-writer schema', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    await exportResults('eval_2026-03-18.jsonl', content, outputDir);

    const summaryPath = path.join(outputDir, 'summary.json');
    expect(existsSync(summaryPath)).toBe(true);

    const summary: RunSummaryArtifact = JSON.parse(readFileSync(summaryPath, 'utf8'));
    expect(summary.metadata.eval_file).toBe('eval_2026-03-18.jsonl');
    expect(summary.metadata.timestamp).toBe('2026-03-18T10:00:01.000Z');
    // artifact-writer uses string[] for tests_run, not a count
    expect(summary.metadata.tests_run).toEqual(['test-greeting', 'test-math']);
    expect(summary.metadata.targets).toEqual(['gpt-4o']);

    // run_summary has mean+stddev (artifact-writer format)
    expect(summary.run_summary['gpt-4o']).toBeDefined();
    expect(summary.run_summary['gpt-4o'].pass_rate).toHaveProperty('mean');
    expect(summary.run_summary['gpt-4o'].pass_rate).toHaveProperty('stddev');
  });

  it('should create index.jsonl with per-test artifact pointers', async () => {
    const outputDir = path.join(tempDir, 'output');
    const resultWithInput = {
      ...RESULT_FULL,
      execution_status: 'ok',
      input: [{ role: 'user', content: 'Hello' }],
    };
    const content = toJsonl(resultWithInput);

    await exportResults('test.jsonl', content, outputDir);

    const indexPath = path.join(outputDir, 'index.jsonl');
    expect(existsSync(indexPath)).toBe(true);

    const entries = readFileSync(indexPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as IndexArtifactEntry);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      test_id: 'test-greeting',
      target: 'gpt-4o',
      execution_status: 'ok',
      summary_path: 'demo/test-greeting/summary.json',
      grading_path: 'demo/test-greeting/run-1/grading.json',
      output_path: 'demo/test-greeting/run-1/outputs/answer.md',
      answer_path: 'demo/test-greeting/run-1/outputs/answer.md',
      transcript_path: 'demo/test-greeting/run-1/transcript-raw.jsonl',
    });
    expect(entries[0].input_path).toBeUndefined();
    expect(entries[0].projection_identity).toMatchObject({
      schema_version: 'agentv.projection_identity.v1',
      dimensions: {
        run_id: 'test',
        suite: 'demo',
        eval_path: 'test.jsonl',
        test_id: 'test-greeting',
        target: 'gpt-4o',
        source_target: 'gpt-4o',
        attempt: 0,
        variant: null,
        projection_format: 'execution_trace',
        projection_version: 'agentv.trace.v1',
      },
    });
    expect(entries[0].export_metadata).toMatchObject({
      duplicate_policy: 'update',
    });
  });

  it('keeps projection IDs stable across repeated exports from the same run', async () => {
    const sourceFile = path.join(
      tempDir,
      '.agentv',
      'results',
      'runs',
      '2026-03-18T10-00-00-000Z',
      'index.jsonl',
    );
    const firstOutputDir = path.join(tempDir, 'first-output');
    const secondOutputDir = path.join(tempDir, 'second-output');
    const content = toJsonl(RESULT_FULL);

    await exportResults(sourceFile, content, firstOutputDir);
    await exportResults(sourceFile, content, secondOutputDir);

    const [first] = readIndex(firstOutputDir);
    const [second] = readIndex(secondOutputDir);
    expect(first.projection_identity?.id).toBe(second.projection_identity?.id);
    expect(first.projection_identity?.key).toBe(second.projection_identity?.key);
    expect(first.projection_identity?.dimensions.run_id).toBe('2026-03-18T10-00-00-000Z');
  });

  it('updates duplicate projection artifacts when duplicate policy is update', async () => {
    const sourceFile = path.join(tempDir, 'runs', 'retry-run', 'index.jsonl');
    const outputDir = path.join(tempDir, 'output');
    const updated = { ...RESULT_FULL, output: 'Updated answer.' };

    await exportResults(sourceFile, toJsonl(RESULT_FULL), outputDir, {
      duplicatePolicy: 'update',
    });
    const before = readIndex(outputDir)[0]?.projection_identity?.id;
    await exportResults(sourceFile, toJsonl(updated), outputDir, {
      duplicatePolicy: 'update',
    });

    const [entry] = readIndex(outputDir);
    expect(entry.projection_identity?.id).toBe(before);
    expect(entry.export_metadata).toMatchObject({ duplicate_policy: 'update' });
    expect(readAnswer(outputDir, RESULT_FULL)).toBe('Updated answer.');
  });

  it('skips duplicate projection artifacts when duplicate policy is skip', async () => {
    const sourceFile = path.join(tempDir, 'runs', 'retry-run', 'index.jsonl');
    const outputDir = path.join(tempDir, 'output');
    const updated = { ...RESULT_FULL, output: 'Skipped answer.' };

    await exportResults(sourceFile, toJsonl(RESULT_FULL), outputDir, {
      duplicatePolicy: 'update',
    });
    const before = readIndex(outputDir)[0]?.projection_identity?.id;
    await exportResults(sourceFile, toJsonl(updated), outputDir, {
      duplicatePolicy: 'skip',
    });

    const [entry] = readIndex(outputDir);
    expect(entry.projection_identity?.id).toBe(before);
    expect(entry.export_metadata).toMatchObject({ duplicate_policy: 'skip', skipped: true });
    expect(readAnswer(outputDir, RESULT_FULL)).toBe('Hello, Alice!');
  });

  it('builds projection bundles from emitted skipped artifacts for duplicate policy skip', async () => {
    const sourceFile = path.join(tempDir, 'runs', 'retry-run', 'index.jsonl');
    const outputDir = path.join(tempDir, 'output');
    const updated = { ...RESULT_FULL, output: 'Skipped answer.' };

    await exportResults(sourceFile, toJsonl(RESULT_FULL), outputDir, {
      duplicatePolicy: 'update',
    });
    await exportResults(sourceFile, toJsonl(updated), outputDir, {
      duplicatePolicy: 'skip',
    });

    const bundle = buildProjectionBundleFromExportedIndex({
      sourceFile,
      outputDir,
      cwd: tempDir,
      includeRawContent: true,
      duplicatePolicy: 'skip',
    });

    expect(bundle.entries[0].artifact_refs.status).toBe('emitted');
    expect(bundle.entries[0].raw_content?.output).toBe('Hello, Alice!');
    expect(serializeProjectionBundle(bundle)).not.toContain('Skipped answer.');
    expect(bundle.entries[0].trace_envelope.projection_identity).toEqual(
      readIndex(outputDir)[0].projection_identity,
    );
  });

  it('fails duplicate projection artifacts when duplicate policy is error', async () => {
    const sourceFile = path.join(tempDir, 'runs', 'retry-run', 'index.jsonl');
    const outputDir = path.join(tempDir, 'output');
    const updated = { ...RESULT_FULL, output: 'Should not write.' };

    await exportResults(sourceFile, toJsonl(RESULT_FULL), outputDir);
    await expect(
      exportResults(sourceFile, toJsonl(updated), outputDir, {
        duplicatePolicy: 'error',
      }),
    ).rejects.toThrow('Duplicate export projection');

    const [entry] = readIndex(outputDir);
    expect(entry.export_metadata).toMatchObject({ duplicate_policy: 'update' });
    expect(readAnswer(outputDir, RESULT_FULL)).toBe('Hello, Alice!');
  });

  it('should create case summary with run timing', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    await exportResults('test.jsonl', content, outputDir);

    const summaryPath = path.join(artifactDir(outputDir, RESULT_FULL), 'summary.json');
    expect(existsSync(summaryPath)).toBe(true);

    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
      total_tokens: number;
      duration_ms: number;
      token_usage: Record<string, unknown>;
    };
    expect(summary.total_tokens).toBe(1500);
    expect(summary.duration_ms).toBe(3500);
    expect(summary.token_usage).toHaveProperty('input');
    expect(summary.token_usage).toHaveProperty('output');
    expect(summary.token_usage).toHaveProperty('reasoning');
  });

  it('should create per-test artifact directories', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    await exportResults('test.jsonl', content, outputDir);

    const gradingPath = path.join(runDir(outputDir, RESULT_FULL), 'grading.json');
    expect(existsSync(gradingPath)).toBe(true);

    const grading: GradingArtifact = JSON.parse(readFileSync(gradingPath, 'utf8'));

    // Uses artifact-writer's assertions field
    expect(grading.assertions).toBeDefined();
    expect(grading.assertions.length).toBeGreaterThan(0);
    expect(grading.assertions[0]).toHaveProperty('text');
    expect(grading.assertions[0]).toHaveProperty('passed');
    expect(grading.assertions[0]).toHaveProperty('evidence');

    // Has summary
    expect(grading.summary).toBeDefined();
    expect(grading.summary).toHaveProperty('passed');
    expect(grading.summary).toHaveProperty('failed');
    expect(grading.summary).toHaveProperty('total');
    expect(grading.summary).toHaveProperty('pass_rate');

    // Grading artifacts stay focused on assertion evidence; execution data lives in metrics.json.
    expect(grading).not.toHaveProperty('execution_metrics');

    // Has evaluators
    expect(grading.graders).toBeDefined();
    expect(grading.graders).toHaveLength(1);
    expect(grading.graders?.[0].name).toBe('greeting_quality');
    expect(grading.graders?.[0].type).toBe('llm-grader');

    expect(existsSync(path.join(runDir(outputDir, RESULT_FULL), 'metrics.json'))).toBe(true);
    expect(existsSync(path.join(runDir(outputDir, RESULT_FULL), 'timing.json'))).toBe(true);
    expect(existsSync(path.join(runDir(outputDir, RESULT_FULL), 'result.json'))).toBe(false);
  });

  it('should write answer text to <test-id>/run-1/outputs/answer.md as human-readable markdown', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    await exportResults('test.jsonl', content, outputDir);

    const answerPath = path.join(runDir(outputDir, RESULT_FULL), 'outputs', 'answer.md');
    expect(existsSync(answerPath)).toBe(true);
    expect(readFileSync(answerPath, 'utf8')).toBe('Hello, Alice!');

    const responsePath = path.join(artifactDir(outputDir, RESULT_FULL), 'outputs', 'response.md');
    expect(existsSync(responsePath)).toBe(false);
  });

  it('should group results by target in summary.json', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_DIFFERENT_TARGET);

    await exportResults('test.jsonl', content, outputDir);

    const summary: RunSummaryArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'summary.json'), 'utf8'),
    );

    expect(summary.run_summary['gpt-4o']).toBeDefined();
    expect(summary.run_summary['claude-sonnet']).toBeDefined();
  });

  it('should handle results without answer text', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_PARTIAL);

    await exportResults('test.jsonl', content, outputDir);

    const answerPath = path.join(outputDir, 'outputs', 'test-math.md');
    expect(existsSync(answerPath)).toBe(false);
  });

  it('should handle multiple test cases in a single export', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL, RESULT_NO_TRACE);

    await exportResults('test.jsonl', content, outputDir);

    expect(existsSync(path.join(outputDir, 'summary.json'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'index.jsonl'))).toBe(true);
    expect(existsSync(path.join(artifactDir(outputDir, RESULT_FULL), 'summary.json'))).toBe(true);
    expect(existsSync(path.join(runDir(outputDir, RESULT_FULL), 'grading.json'))).toBe(true);
    expect(existsSync(path.join(runDir(outputDir, RESULT_PARTIAL), 'grading.json'))).toBe(true);
    expect(existsSync(path.join(runDir(outputDir, RESULT_NO_TRACE), 'grading.json'))).toBe(true);
  });

  it('should include per-grader summary in summary when scores present', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    await exportResults('test.jsonl', content, outputDir);

    const summary: RunSummaryArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'summary.json'), 'utf8'),
    );

    expect(summary.per_grader_summary).toBeDefined();
  });

  it('should not create output file when answer is missing', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_DIFFERENT_TARGET);

    await exportResults('test.jsonl', content, outputDir);

    const answerPath = path.join(
      runDir(outputDir, RESULT_DIFFERENT_TARGET),
      'outputs',
      'answer.md',
    );
    expect(existsSync(answerPath)).toBe(false);
  });

  it('should throw when content has no valid results', async () => {
    const outputDir = path.join(tempDir, 'output');
    await expect(exportResults('test.jsonl', '', outputDir)).rejects.toThrow('No results found');
  });

  it('should handle results with missing assertions field', async () => {
    const outputDir = path.join(tempDir, 'output');
    const minimal = {
      timestamp: '2026-03-18T10:00:00.000Z',
      test_id: 'test-minimal',
      score: 0.8,
      target: 'default',
    };
    const content = toJsonl(minimal);

    // Should not throw — previously crashed with "Cannot read properties of undefined (reading 'map')"
    await exportResults('test.jsonl', content, outputDir);

    const gradingPath = path.join(
      runDir(outputDir, { ...minimal, target: 'default' }),
      'grading.json',
    );
    expect(existsSync(gradingPath)).toBe(true);

    const grading: GradingArtifact = JSON.parse(readFileSync(gradingPath, 'utf8'));
    expect(grading.assertions).toEqual([]);
    expect(grading.summary.total).toBe(0);
  });

  it('should not write string input to <test-id>/task/PROMPT.md', async () => {
    const outputDir = path.join(tempDir, 'output');
    const resultWithInput = {
      ...RESULT_FULL,
      input: 'What is the capital of France?',
    };
    const content = toJsonl(resultWithInput);

    await exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(artifactDir(outputDir, resultWithInput), 'task', 'PROMPT.md');
    expect(existsSync(inputPath)).toBe(false);
    const [indexEntry] = readFileSync(path.join(outputDir, 'index.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as IndexArtifactEntry);
    expect(indexEntry?.input_path).toBeUndefined();
  });

  it('should not write Message[] input to <test-id>/task/PROMPT.md', async () => {
    const outputDir = path.join(tempDir, 'output');
    const resultWithMessages = {
      ...RESULT_FULL,
      input: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    };
    const content = toJsonl(resultWithMessages);

    await exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(artifactDir(outputDir, resultWithMessages), 'task', 'PROMPT.md');
    expect(existsSync(inputPath)).toBe(false);
    const [indexEntry] = readFileSync(path.join(outputDir, 'index.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as IndexArtifactEntry);
    expect(indexEntry?.input_path).toBeUndefined();
  });

  it('should not create input file when input is missing', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    await exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(artifactDir(outputDir, RESULT_FULL), 'task', 'PROMPT.md');
    expect(existsSync(inputPath)).toBe(false);
  });

  it('should handle results with missing target and testId fields', async () => {
    const outputDir = path.join(tempDir, 'output');
    const bare = {
      timestamp: '2026-03-18T10:00:00.000Z',
      score: 0.5,
    };
    const content = toJsonl(bare);

    await exportResults('test.jsonl', content, outputDir);

    const summary: RunSummaryArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'summary.json'), 'utf8'),
    );
    expect(summary.metadata.targets).toEqual(['unknown']);
    expect(summary.metadata.tests_run).toEqual(['unknown']);
  });

  it('should not create top-level grading.json aggregate artifact', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    await exportResults('test.jsonl', content, outputDir);

    const gradingPath = path.join(outputDir, 'grading.json');
    expect(existsSync(gradingPath)).toBe(false);
  });
});
