/**
 * E2E tests for `agentv results export` across different providers.
 *
 * Validates that reasoning tokens, cached tokens, duration, cost,
 * and other metrics survive the JSONL → artifact conversion pipeline
 * for: claude-cli, codex, copilot-cli, pi-coding-agent, and llm (ai-sdk).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  BenchmarkArtifact,
  GradingArtifact,
  TimingArtifact,
} from '../../../src/commands/eval/artifact-writer.js';
import { exportResults } from '../../../src/commands/results/export.js';

// ── Provider-specific JSONL records (snake_case, matching on-disk format) ──

/** Claude CLI — emits reasoning tokens, cached tokens, cost, full trace */
const CLAUDE_CLI_RESULT = {
  timestamp: '2026-03-18T10:00:00.000Z',
  test_id: 'test-claude-reasoning',
  suite: 'multi-provider',
  score: 1.0,
  assertions: [
    { text: 'Correct answer', passed: true, evidence: 'Matched expected output' },
    { text: 'Used reasoning', passed: true },
  ],
  output: [{ role: 'assistant', content: 'The answer is 42, derived through extended thinking.' }],
  target: 'claude-cli',
  scores: [
    {
      name: 'accuracy',
      type: 'contains',
      score: 1.0,
      assertions: [{ text: 'Contains 42', passed: true }],
    },
  ],
  duration_ms: 8500,
  token_usage: { input: 2000, output: 800, reasoning: 1500, cached: 400 },
  cost_usd: 0.045,
  execution_status: 'ok',
  trace: {
    event_count: 5,
    tool_calls: { Read: 2, Write: 1 },
    error_count: 0,
    llm_call_count: 3,
    steps: [
      { toolName: 'Read', type: 'tool' },
      { toolName: 'Read', type: 'tool' },
      { toolName: 'Write', type: 'tool' },
    ],
  },
};

/** Codex CLI — reasoning model, typically has reasoning tokens */
const CODEX_RESULT = {
  timestamp: '2026-03-18T10:01:00.000Z',
  test_id: 'test-codex-edit',
  suite: 'multi-provider',
  score: 0.9,
  assertions: [
    { text: 'File edited correctly', passed: true },
    { text: 'No extra changes', passed: true },
  ],
  output: [{ role: 'assistant', content: 'Applied the requested edit to src/main.ts.' }],
  target: 'codex',
  scores: [
    {
      name: 'edit_quality',
      type: 'code-grader',
      score: 0.9,
      assertions: [{ text: 'File edited correctly', passed: true }],
    },
  ],
  duration_ms: 12000,
  token_usage: { input: 3000, output: 1200, reasoning: 2500 },
  cost_usd: 0.08,
  execution_status: 'ok',
  trace: {
    event_count: 3,
    tool_calls: { shell: 2 },
    error_count: 0,
    llm_call_count: 2,
    steps: [
      { toolName: 'shell', type: 'tool' },
      { toolName: 'shell', type: 'tool' },
    ],
  },
};

/** Copilot CLI — no reasoning tokens, ACP usage_update style */
const COPILOT_RESULT = {
  timestamp: '2026-03-18T10:02:00.000Z',
  test_id: 'test-copilot-complete',
  suite: 'multi-provider',
  score: 0.85,
  assertions: [
    { text: 'Code completion correct', passed: true },
    { text: 'Follows style guide', passed: false, evidence: 'Missing semicolons' },
  ],
  output: [{ role: 'assistant', content: 'function add(a, b) { return a + b }' }],
  target: 'copilot-cli',
  scores: [
    {
      name: 'completion_quality',
      type: 'llm-grader',
      score: 0.85,
      assertions: [
        { text: 'Code completion correct', passed: true },
        { text: 'Follows style guide', passed: false },
      ],
    },
  ],
  duration_ms: 3200,
  token_usage: { input: 500, output: 150 },
  cost_usd: 0.005,
  execution_status: 'ok',
};

/** Pi Coding Agent — similar to Claude CLI, subprocess provider */
const PI_RESULT = {
  timestamp: '2026-03-18T10:03:00.000Z',
  test_id: 'test-pi-refactor',
  suite: 'multi-provider',
  score: 0.75,
  assertions: [
    { text: 'Refactored correctly', passed: true },
    { text: 'Tests pass', passed: false, evidence: 'Test suite has 1 failure' },
  ],
  output: [{ role: 'assistant', content: 'Refactored the module to use dependency injection.' }],
  target: 'pi-coding-agent',
  duration_ms: 15000,
  token_usage: { input: 4000, output: 2000 },
  cost_usd: 0.12,
  execution_status: 'quality_failure',
};

/** LLM (AI SDK) — Azure OpenAI with reasoning tokens (o-series models) */
const LLM_AZURE_RESULT = {
  timestamp: '2026-03-18T10:04:00.000Z',
  test_id: 'test-llm-analysis',
  suite: 'multi-provider',
  score: 1.0,
  assertions: [{ text: 'Analysis correct', passed: true }],
  output: [{ role: 'assistant', content: 'The code has a race condition in the connection pool.' }],
  target: 'azure-o4-mini',
  scores: [
    {
      name: 'analysis_depth',
      type: 'llm-grader',
      score: 1.0,
      assertions: [{ text: 'Analysis correct', passed: true }],
    },
  ],
  duration_ms: 5500,
  token_usage: { input: 1500, output: 600, reasoning: 3000, cached: 200 },
  cost_usd: 0.025,
  execution_status: 'ok',
};

/** LLM (AI SDK) — GPT-4.1 with no reasoning tokens */
const LLM_GPT_RESULT = {
  timestamp: '2026-03-18T10:05:00.000Z',
  test_id: 'test-llm-analysis',
  suite: 'multi-provider',
  score: 0.8,
  assertions: [{ text: 'Analysis correct', passed: true }],
  output: [{ role: 'assistant', content: 'There might be a concurrency issue.' }],
  target: 'gpt-4.1',
  duration_ms: 2800,
  token_usage: { input: 1200, output: 400 },
  cost_usd: 0.01,
  execution_status: 'ok',
};

/** Result with no token_usage or duration (edge case) */
const MINIMAL_RESULT = {
  timestamp: '2026-03-18T10:06:00.000Z',
  test_id: 'test-minimal',
  suite: 'multi-provider',
  score: 0.5,
  assertions: [{ text: 'Exists', passed: true }],
  output: [{ role: 'assistant', content: 'Response.' }],
  target: 'mock',
  execution_status: 'ok',
};

/** Result with execution error */
const ERROR_RESULT = {
  timestamp: '2026-03-18T10:07:00.000Z',
  test_id: 'test-error-case',
  suite: 'multi-provider',
  score: 0,
  assertions: [],
  output: [],
  target: 'claude-cli',
  error: 'Agent timed out after 120s',
  duration_ms: 120000,
  token_usage: { input: 5000, output: 200, reasoning: 100 },
  execution_status: 'execution_error',
  failure_stage: 'agent',
  failure_reason_code: 'AGENT_TIMEOUT',
};

function toJsonl(...records: object[]): string {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

function artifactDir(outputDir: string, record: { suite?: string; test_id?: string }): string {
  const testId = record.test_id ?? 'unknown';
  return path.join(outputDir, ...(record.suite ? [record.suite] : []), testId);
}

describe('export e2e — multi-provider metrics verification', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-export-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Timing artifact tests ──────────────────────────────────────────────

  describe('<test-id>/timing.json — per-test timing', () => {
    it('should include reasoning tokens in token_usage', async () => {
      const outputDir = path.join(tempDir, 'claude');
      const content = toJsonl(CLAUDE_CLI_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, CLAUDE_CLI_RESULT), 'timing.json'), 'utf8'),
      );

      expect(timing.token_usage.input).toBe(2000);
      expect(timing.token_usage.output).toBe(800);
      expect(timing.token_usage.reasoning).toBe(1500);
    });

    it('should write independent timing files for multiple providers', async () => {
      const outputDir = path.join(tempDir, 'multi');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT, COPILOT_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const claudeTiming: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, CLAUDE_CLI_RESULT), 'timing.json'), 'utf8'),
      );
      const codexTiming: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, CODEX_RESULT), 'timing.json'), 'utf8'),
      );
      const copilotTiming: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, COPILOT_RESULT), 'timing.json'), 'utf8'),
      );

      expect(claudeTiming.token_usage.reasoning).toBe(1500);
      expect(codexTiming.token_usage.reasoning).toBe(2500);
      expect(copilotTiming.token_usage.reasoning).toBe(0);
    });

    it('should compute total_tokens as input + output (not including reasoning)', async () => {
      const outputDir = path.join(tempDir, 'totals');
      const content = toJsonl(CLAUDE_CLI_RESULT, LLM_AZURE_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, CLAUDE_CLI_RESULT), 'timing.json'), 'utf8'),
      );

      expect(timing.total_tokens).toBe(2800);
    });

    it('should preserve duration_ms per test result', async () => {
      const outputDir = path.join(tempDir, 'duration');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT, COPILOT_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, CODEX_RESULT), 'timing.json'), 'utf8'),
      );

      expect(timing.duration_ms).toBe(12000);
      expect(timing.total_duration_seconds).toBe(12);
    });

    it('should handle results with no token_usage gracefully', async () => {
      const outputDir = path.join(tempDir, 'minimal');
      const content = toJsonl(MINIMAL_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, MINIMAL_RESULT), 'timing.json'), 'utf8'),
      );

      expect(timing.total_tokens).toBe(0);
      expect(timing.duration_ms).toBe(0);
      expect(timing.token_usage.input).toBe(0);
      expect(timing.token_usage.output).toBe(0);
      expect(timing.token_usage.reasoning).toBe(0);
    });

    it('should handle providers with and without reasoning tokens', async () => {
      const outputDir = path.join(tempDir, 'mixed');
      const content = toJsonl(CLAUDE_CLI_RESULT, COPILOT_RESULT, LLM_GPT_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const claudeTiming: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, CLAUDE_CLI_RESULT), 'timing.json'), 'utf8'),
      );
      const copilotTiming: TimingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, COPILOT_RESULT), 'timing.json'), 'utf8'),
      );

      expect(claudeTiming.token_usage.reasoning).toBe(1500);
      expect(copilotTiming.token_usage.reasoning).toBe(0);
    });
  });

  // ── Benchmark artifact tests ───────────────────────────────────────────

  describe('benchmark.json — per-target summary', () => {
    it('should group results by target with correct pass rates', async () => {
      const outputDir = path.join(tempDir, 'benchmark');
      const content = toJsonl(
        CLAUDE_CLI_RESULT,
        CODEX_RESULT,
        COPILOT_RESULT,
        PI_RESULT,
        LLM_AZURE_RESULT,
        LLM_GPT_RESULT,
      );

      await exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // All 6 targets should be represented
      expect(benchmark.metadata.targets).toContain('claude-cli');
      expect(benchmark.metadata.targets).toContain('codex');
      expect(benchmark.metadata.targets).toContain('copilot-cli');
      expect(benchmark.metadata.targets).toContain('pi-coding-agent');
      expect(benchmark.metadata.targets).toContain('azure-o4-mini');
      expect(benchmark.metadata.targets).toContain('gpt-4.1');
    });

    it('should report correct time_seconds per target', async () => {
      const outputDir = path.join(tempDir, 'bench-time');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // claude: 8500ms = 8.5s
      expect(benchmark.run_summary['claude-cli'].time_seconds.mean).toBe(8.5);
      // codex: 12000ms = 12s
      expect(benchmark.run_summary.codex.time_seconds.mean).toBe(12);
    });

    it('should report correct token counts per target (input + output)', async () => {
      const outputDir = path.join(tempDir, 'bench-tokens');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // claude: 2000 + 800 = 2800
      expect(benchmark.run_summary['claude-cli'].tokens.mean).toBe(2800);
      // codex: 3000 + 1200 = 4200
      expect(benchmark.run_summary.codex.tokens.mean).toBe(4200);
    });

    it('should include cost_usd when available', async () => {
      const outputDir = path.join(tempDir, 'bench-cost');
      const content = toJsonl(CLAUDE_CLI_RESULT, LLM_AZURE_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      expect(benchmark.run_summary['claude-cli'].cost_usd).toBeDefined();
      expect(benchmark.run_summary['claude-cli'].cost_usd?.mean).toBe(0.045);
      expect(benchmark.run_summary['azure-o4-mini'].cost_usd?.mean).toBe(0.025);
    });

    it('should include tool_calls when trace has tool data', async () => {
      const outputDir = path.join(tempDir, 'bench-tools');
      const content = toJsonl(CLAUDE_CLI_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // Claude has 3 tool calls in trace steps
      expect(benchmark.run_summary['claude-cli'].tool_calls).toBeDefined();
      expect(benchmark.run_summary['claude-cli'].tool_calls?.mean).toBe(3);
    });

    it('should note execution errors in notes', async () => {
      const outputDir = path.join(tempDir, 'bench-errors');
      const content = toJsonl(CLAUDE_CLI_RESULT, ERROR_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      expect(benchmark.notes.length).toBeGreaterThan(0);
      expect(benchmark.notes.some((n) => n.includes('execution error'))).toBe(true);
    });

    it('should include per_grader_summary across providers', async () => {
      const outputDir = path.join(tempDir, 'bench-eval');
      const content = toJsonl(CLAUDE_CLI_RESULT, LLM_AZURE_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      expect(benchmark.per_grader_summary).toBeDefined();
    });
  });

  // ── Grading artifact tests ─────────────────────────────────────────────

  describe('<test-id>/grading.json — per-test grading', () => {
    it('should produce correct grading for Claude CLI result with trace', async () => {
      const outputDir = path.join(tempDir, 'grade-claude');
      const content = toJsonl(CLAUDE_CLI_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const grading: GradingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, CLAUDE_CLI_RESULT), 'grading.json'), 'utf8'),
      );

      expect(grading.assertions).toHaveLength(2);
      expect(grading.assertions[0].text).toBe('Correct answer');
      expect(grading.assertions[0].evidence).toBe('Matched expected output');
      expect(grading.summary.passed).toBe(2);
      expect(grading.summary.failed).toBe(0);
      expect(grading.summary.pass_rate).toBe(1.0);

      // Tool calls from trace
      expect(grading.execution_metrics.total_tool_calls).toBe(3);
      expect(grading.execution_metrics.tool_calls.Read).toBe(2);
      expect(grading.execution_metrics.tool_calls.Write).toBe(1);

      // Graders
      expect(grading.graders).toHaveLength(1);
      expect(grading.graders?.[0].name).toBe('accuracy');
    });

    it('should produce correct grading for Copilot CLI result with mixed assertions', async () => {
      const outputDir = path.join(tempDir, 'grade-copilot');
      const content = toJsonl(COPILOT_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const grading: GradingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, COPILOT_RESULT), 'grading.json'), 'utf8'),
      );

      expect(grading.summary.passed).toBe(1);
      expect(grading.summary.failed).toBe(1);
      expect(grading.summary.pass_rate).toBe(0.5);

      // No trace means no tool calls
      expect(grading.execution_metrics.total_tool_calls).toBe(0);
    });

    it('should handle error result in grading', async () => {
      const outputDir = path.join(tempDir, 'grade-error');
      const content = toJsonl(ERROR_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      const grading: GradingArtifact = JSON.parse(
        readFileSync(path.join(artifactDir(outputDir, ERROR_RESULT), 'grading.json'), 'utf8'),
      );

      // Error result has empty assertions
      expect(grading.summary.total).toBe(0);
      expect(grading.summary.pass_rate).toBe(0);
      expect(grading.execution_metrics.errors_encountered).toBe(1);
    });

    it('should produce grading files for all test IDs in multi-target run', async () => {
      const outputDir = path.join(tempDir, 'grade-multi');
      const content = toJsonl(LLM_AZURE_RESULT, LLM_GPT_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      expect(existsSync(path.join(artifactDir(outputDir, LLM_AZURE_RESULT), 'grading.json'))).toBe(
        true,
      );
      expect(existsSync(path.join(artifactDir(outputDir, LLM_GPT_RESULT), 'grading.json'))).toBe(
        true,
      );
    });
  });

  // ── Output artifact tests ──────────────────────────────────────────────

  describe('<test-id>/outputs/response.md — human-readable agent responses', () => {
    it('should write answer text for each provider as markdown', async () => {
      const outputDir = path.join(tempDir, 'outputs');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT, COPILOT_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      expect(
        readFileSync(
          path.join(artifactDir(outputDir, CLAUDE_CLI_RESULT), 'outputs', 'response.md'),
          'utf8',
        ),
      ).toBe('@[assistant]:\nThe answer is 42, derived through extended thinking.');

      expect(
        readFileSync(
          path.join(artifactDir(outputDir, CODEX_RESULT), 'outputs', 'response.md'),
          'utf8',
        ),
      ).toBe('@[assistant]:\nApplied the requested edit to src/main.ts.');

      expect(
        readFileSync(
          path.join(artifactDir(outputDir, COPILOT_RESULT), 'outputs', 'response.md'),
          'utf8',
        ),
      ).toBe('@[assistant]:\nfunction add(a, b) { return a + b }');
    });

    it('should not write output file for error result with empty answer', async () => {
      const outputDir = path.join(tempDir, 'outputs-error');
      const content = toJsonl(ERROR_RESULT);

      await exportResults('test.jsonl', content, outputDir);

      expect(
        existsSync(path.join(artifactDir(outputDir, ERROR_RESULT), 'outputs', 'response.md')),
      ).toBe(false);
    });
  });

  // ── Full pipeline e2e test ─────────────────────────────────────────────

  describe('full pipeline — all providers combined', () => {
    it('should produce complete artifact set from all providers', async () => {
      const outputDir = path.join(tempDir, 'full');
      const content = toJsonl(
        CLAUDE_CLI_RESULT,
        CODEX_RESULT,
        COPILOT_RESULT,
        PI_RESULT,
        LLM_AZURE_RESULT,
        LLM_GPT_RESULT,
        MINIMAL_RESULT,
        ERROR_RESULT,
      );

      await exportResults('eval_2026-03-18.jsonl', content, outputDir);

      // Verify all artifact files exist
      expect(existsSync(path.join(outputDir, 'benchmark.json'))).toBe(true);
      expect(existsSync(path.join(outputDir, 'timing.json'))).toBe(true);

      // Verify benchmark
      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // 7 unique targets (claude-cli appears twice with error result)
      expect(benchmark.metadata.targets.length).toBe(7);
      expect(benchmark.metadata.eval_file).toBe('eval_2026-03-18.jsonl');

      // Verify grading files
      expect(existsSync(path.join(artifactDir(outputDir, CLAUDE_CLI_RESULT), 'grading.json'))).toBe(
        true,
      );
      expect(existsSync(path.join(artifactDir(outputDir, CODEX_RESULT), 'grading.json'))).toBe(
        true,
      );
      expect(existsSync(path.join(artifactDir(outputDir, COPILOT_RESULT), 'grading.json'))).toBe(
        true,
      );
      expect(existsSync(path.join(artifactDir(outputDir, PI_RESULT), 'grading.json'))).toBe(true);
      expect(existsSync(path.join(artifactDir(outputDir, LLM_AZURE_RESULT), 'grading.json'))).toBe(
        true,
      );
      expect(existsSync(path.join(artifactDir(outputDir, LLM_GPT_RESULT), 'grading.json'))).toBe(
        true,
      );
      expect(existsSync(path.join(artifactDir(outputDir, MINIMAL_RESULT), 'grading.json'))).toBe(
        true,
      );
      expect(existsSync(path.join(artifactDir(outputDir, ERROR_RESULT), 'grading.json'))).toBe(
        true,
      );
    });
  });

  // ── JSONL snake_case ↔ camelCase round-trip ────────────────────────────

  describe('snake_case → camelCase conversion', () => {
    it('should convert nested token_usage fields correctly', async () => {
      const outputDir = path.join(tempDir, 'case-convert');
      // Explicitly use deeply nested snake_case to test toCamelCaseDeep
      const record = {
        timestamp: '2026-03-18T10:00:00.000Z',
        test_id: 'test-case-convert',
        suite: 'test',
        score: 1.0,
        assertions: [{ text: 'ok', passed: true }],
        output_text: 'ok',
        target: 'mock',
        duration_ms: 1000,
        token_usage: { input: 100, output: 50, reasoning: 75, cached: 25 },
        cost_usd: 0.001,
        execution_status: 'ok',
        eval_run: {
          duration_ms: 2000,
          token_usage: { input: 200, output: 100 },
        },
      };

      await exportResults('test.jsonl', toJsonl(record), outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(
          path.join(artifactDir(outputDir, { ...record, target: 'mock' as const }), 'timing.json'),
          'utf8',
        ),
      );

      expect(timing.token_usage.input).toBe(100);
      expect(timing.token_usage.output).toBe(50);
      expect(timing.token_usage.reasoning).toBe(75);
      expect(timing.duration_ms).toBe(1000);
    });
  });
});
