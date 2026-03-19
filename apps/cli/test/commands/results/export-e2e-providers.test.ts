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
  dataset: 'multi-provider',
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
  dataset: 'multi-provider',
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
  dataset: 'multi-provider',
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
  dataset: 'multi-provider',
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
  dataset: 'multi-provider',
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
  dataset: 'multi-provider',
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
  dataset: 'multi-provider',
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
  dataset: 'multi-provider',
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

describe('export e2e — multi-provider metrics verification', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-export-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Timing artifact tests ──────────────────────────────────────────────

  describe('timing.json — token aggregation', () => {
    it('should include reasoning tokens in token_usage', () => {
      const outputDir = path.join(tempDir, 'claude');
      const content = toJsonl(CLAUDE_CLI_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'timing.json'), 'utf8'),
      );

      expect(timing.token_usage.input).toBe(2000);
      expect(timing.token_usage.output).toBe(800);
      expect(timing.token_usage.reasoning).toBe(1500);
    });

    it('should aggregate reasoning tokens across multiple providers', () => {
      const outputDir = path.join(tempDir, 'multi');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT, COPILOT_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'timing.json'), 'utf8'),
      );

      // input: 2000 + 3000 + 500 = 5500
      expect(timing.token_usage.input).toBe(5500);
      // output: 800 + 1200 + 150 = 2150
      expect(timing.token_usage.output).toBe(2150);
      // reasoning: 1500 + 2500 + 0 = 4000
      expect(timing.token_usage.reasoning).toBe(4000);
    });

    it('should correctly compute total_tokens as input + output (not including reasoning)', () => {
      const outputDir = path.join(tempDir, 'totals');
      const content = toJsonl(CLAUDE_CLI_RESULT, LLM_AZURE_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'timing.json'), 'utf8'),
      );

      // total_tokens = (2000+800) + (1500+600) = 4900
      // NOTE: total_tokens intentionally excludes reasoning tokens
      // Reasoning tokens are tracked separately in token_usage.reasoning
      expect(timing.total_tokens).toBe(4900);
    });

    it('should aggregate duration_ms across all results', () => {
      const outputDir = path.join(tempDir, 'duration');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT, COPILOT_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'timing.json'), 'utf8'),
      );

      // 8500 + 12000 + 3200 = 23700
      expect(timing.duration_ms).toBe(23700);
      expect(timing.total_duration_seconds).toBe(23.7);
    });

    it('should handle results with no token_usage gracefully', () => {
      const outputDir = path.join(tempDir, 'minimal');
      const content = toJsonl(MINIMAL_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'timing.json'), 'utf8'),
      );

      expect(timing.total_tokens).toBe(0);
      expect(timing.duration_ms).toBe(0);
      expect(timing.token_usage.input).toBe(0);
      expect(timing.token_usage.output).toBe(0);
      expect(timing.token_usage.reasoning).toBe(0);
    });

    it('should handle mix of results with and without reasoning tokens', () => {
      const outputDir = path.join(tempDir, 'mixed');
      const content = toJsonl(CLAUDE_CLI_RESULT, COPILOT_RESULT, LLM_GPT_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'timing.json'), 'utf8'),
      );

      // reasoning only from claude: 1500
      expect(timing.token_usage.reasoning).toBe(1500);
      // input: 2000 + 500 + 1200 = 3700
      expect(timing.token_usage.input).toBe(3700);
    });
  });

  // ── Benchmark artifact tests ───────────────────────────────────────────

  describe('benchmark.json — per-target summary', () => {
    it('should group results by target with correct pass rates', () => {
      const outputDir = path.join(tempDir, 'benchmark');
      const content = toJsonl(
        CLAUDE_CLI_RESULT,
        CODEX_RESULT,
        COPILOT_RESULT,
        PI_RESULT,
        LLM_AZURE_RESULT,
        LLM_GPT_RESULT,
      );

      exportResults('test.jsonl', content, outputDir);

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

    it('should report correct time_seconds per target', () => {
      const outputDir = path.join(tempDir, 'bench-time');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // claude: 8500ms = 8.5s
      expect(benchmark.run_summary['claude-cli'].time_seconds.mean).toBe(8.5);
      // codex: 12000ms = 12s
      expect(benchmark.run_summary.codex.time_seconds.mean).toBe(12);
    });

    it('should report correct token counts per target (input + output)', () => {
      const outputDir = path.join(tempDir, 'bench-tokens');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // claude: 2000 + 800 = 2800
      expect(benchmark.run_summary['claude-cli'].tokens.mean).toBe(2800);
      // codex: 3000 + 1200 = 4200
      expect(benchmark.run_summary.codex.tokens.mean).toBe(4200);
    });

    it('should include cost_usd when available', () => {
      const outputDir = path.join(tempDir, 'bench-cost');
      const content = toJsonl(CLAUDE_CLI_RESULT, LLM_AZURE_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      expect(benchmark.run_summary['claude-cli'].cost_usd).toBeDefined();
      expect(benchmark.run_summary['claude-cli'].cost_usd?.mean).toBe(0.045);
      expect(benchmark.run_summary['azure-o4-mini'].cost_usd?.mean).toBe(0.025);
    });

    it('should include tool_calls when trace has tool data', () => {
      const outputDir = path.join(tempDir, 'bench-tools');
      const content = toJsonl(CLAUDE_CLI_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // Claude has 3 tool calls in trace steps
      expect(benchmark.run_summary['claude-cli'].tool_calls).toBeDefined();
      expect(benchmark.run_summary['claude-cli'].tool_calls?.mean).toBe(3);
    });

    it('should note execution errors in notes', () => {
      const outputDir = path.join(tempDir, 'bench-errors');
      const content = toJsonl(CLAUDE_CLI_RESULT, ERROR_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      expect(benchmark.notes.length).toBeGreaterThan(0);
      expect(benchmark.notes.some((n) => n.includes('execution error'))).toBe(true);
    });

    it('should include per_evaluator_summary across providers', () => {
      const outputDir = path.join(tempDir, 'bench-eval');
      const content = toJsonl(CLAUDE_CLI_RESULT, LLM_AZURE_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      expect(benchmark.per_evaluator_summary).toBeDefined();
    });
  });

  // ── Grading artifact tests ─────────────────────────────────────────────

  describe('grading/<test-id>.json — per-test grading', () => {
    it('should produce correct grading for Claude CLI result with trace', () => {
      const outputDir = path.join(tempDir, 'grade-claude');
      const content = toJsonl(CLAUDE_CLI_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const grading: GradingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'grading', 'test-claude-reasoning.json'), 'utf8'),
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

      // Evaluators
      expect(grading.evaluators).toHaveLength(1);
      expect(grading.evaluators?.[0].name).toBe('accuracy');
    });

    it('should produce correct grading for Copilot CLI result with mixed assertions', () => {
      const outputDir = path.join(tempDir, 'grade-copilot');
      const content = toJsonl(COPILOT_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const grading: GradingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'grading', 'test-copilot-complete.json'), 'utf8'),
      );

      expect(grading.summary.passed).toBe(1);
      expect(grading.summary.failed).toBe(1);
      expect(grading.summary.pass_rate).toBe(0.5);

      // No trace means no tool calls
      expect(grading.execution_metrics.total_tool_calls).toBe(0);
    });

    it('should handle error result in grading', () => {
      const outputDir = path.join(tempDir, 'grade-error');
      const content = toJsonl(ERROR_RESULT);

      exportResults('test.jsonl', content, outputDir);

      const grading: GradingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'grading', 'test-error-case.json'), 'utf8'),
      );

      // Error result has empty assertions
      expect(grading.summary.total).toBe(0);
      expect(grading.summary.pass_rate).toBe(0);
      expect(grading.execution_metrics.errors_encountered).toBe(1);
    });

    it('should produce grading files for all test IDs in multi-target run', () => {
      const outputDir = path.join(tempDir, 'grade-multi');
      const content = toJsonl(LLM_AZURE_RESULT, LLM_GPT_RESULT);

      exportResults('test.jsonl', content, outputDir);

      // Both have same test_id but different targets — export creates
      // files keyed by test_id, so last one wins (or both write)
      const gradingPath = path.join(outputDir, 'grading', 'test-llm-analysis.json');
      expect(existsSync(gradingPath)).toBe(true);
    });
  });

  // ── Output artifact tests ──────────────────────────────────────────────

  describe('outputs/<test-id>.txt — raw agent responses', () => {
    it('should write answer text for each provider', () => {
      const outputDir = path.join(tempDir, 'outputs');
      const content = toJsonl(CLAUDE_CLI_RESULT, CODEX_RESULT, COPILOT_RESULT);

      exportResults('test.jsonl', content, outputDir);

      expect(
        JSON.parse(
          readFileSync(path.join(outputDir, 'outputs', 'test-claude-reasoning.txt'), 'utf8'),
        ),
      ).toEqual([
        { role: 'assistant', content: 'The answer is 42, derived through extended thinking.' },
      ]);

      expect(
        JSON.parse(readFileSync(path.join(outputDir, 'outputs', 'test-codex-edit.txt'), 'utf8')),
      ).toEqual([{ role: 'assistant', content: 'Applied the requested edit to src/main.ts.' }]);

      expect(
        JSON.parse(
          readFileSync(path.join(outputDir, 'outputs', 'test-copilot-complete.txt'), 'utf8'),
        ),
      ).toEqual([{ role: 'assistant', content: 'function add(a, b) { return a + b }' }]);
    });

    it('should not write output file for error result with empty answer', () => {
      const outputDir = path.join(tempDir, 'outputs-error');
      const content = toJsonl(ERROR_RESULT);

      exportResults('test.jsonl', content, outputDir);

      expect(existsSync(path.join(outputDir, 'outputs', 'test-error-case.txt'))).toBe(false);
    });
  });

  // ── Full pipeline e2e test ─────────────────────────────────────────────

  describe('full pipeline — all providers combined', () => {
    it('should produce complete artifact set from all providers', () => {
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

      exportResults('eval_2026-03-18.jsonl', content, outputDir);

      // Verify all artifact files exist
      expect(existsSync(path.join(outputDir, 'benchmark.json'))).toBe(true);
      expect(existsSync(path.join(outputDir, 'timing.json'))).toBe(true);

      // Verify timing aggregation across all 8 results
      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'timing.json'), 'utf8'),
      );

      // Sum input: 2000+3000+500+4000+1500+1200+0+5000 = 17200
      expect(timing.token_usage.input).toBe(17200);
      // Sum output: 800+1200+150+2000+600+400+0+200 = 5350
      expect(timing.token_usage.output).toBe(5350);
      // Sum reasoning: 1500+2500+0+0+3000+0+0+100 = 7100
      expect(timing.token_usage.reasoning).toBe(7100);
      // total_tokens = input + output = 22550
      expect(timing.total_tokens).toBe(22550);
      // Sum duration: 8500+12000+3200+15000+5500+2800+0+120000 = 167000
      expect(timing.duration_ms).toBe(167000);

      // Verify benchmark
      const benchmark: BenchmarkArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
      );

      // 7 unique targets (claude-cli appears twice with error result)
      expect(benchmark.metadata.targets.length).toBe(7);
      expect(benchmark.metadata.eval_file).toBe('eval_2026-03-18.jsonl');

      // Verify grading files
      expect(existsSync(path.join(outputDir, 'grading', 'test-claude-reasoning.json'))).toBe(true);
      expect(existsSync(path.join(outputDir, 'grading', 'test-codex-edit.json'))).toBe(true);
      expect(existsSync(path.join(outputDir, 'grading', 'test-copilot-complete.json'))).toBe(true);
      expect(existsSync(path.join(outputDir, 'grading', 'test-pi-refactor.json'))).toBe(true);
      expect(existsSync(path.join(outputDir, 'grading', 'test-llm-analysis.json'))).toBe(true);
      expect(existsSync(path.join(outputDir, 'grading', 'test-minimal.json'))).toBe(true);
      expect(existsSync(path.join(outputDir, 'grading', 'test-error-case.json'))).toBe(true);
    });
  });

  // ── JSONL snake_case ↔ camelCase round-trip ────────────────────────────

  describe('snake_case → camelCase conversion', () => {
    it('should convert nested token_usage fields correctly', () => {
      const outputDir = path.join(tempDir, 'case-convert');
      // Explicitly use deeply nested snake_case to test toCamelCaseDeep
      const record = {
        timestamp: '2026-03-18T10:00:00.000Z',
        test_id: 'test-case-convert',
        dataset: 'test',
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

      exportResults('test.jsonl', toJsonl(record), outputDir);

      const timing: TimingArtifact = JSON.parse(
        readFileSync(path.join(outputDir, 'timing.json'), 'utf8'),
      );

      expect(timing.token_usage.input).toBe(100);
      expect(timing.token_usage.output).toBe(50);
      expect(timing.token_usage.reasoning).toBe(75);
      expect(timing.duration_ms).toBe(1000);
    });

    it('should handle eval_id (legacy) as test_id alias', () => {
      const outputDir = path.join(tempDir, 'legacy');
      const record = {
        timestamp: '2026-03-18T10:00:00.000Z',
        eval_id: 'legacy-test-id',
        dataset: 'test',
        score: 1.0,
        assertions: [{ text: 'ok', passed: true }],
        output_text: 'ok',
        target: 'mock',
        execution_status: 'ok',
      };

      exportResults('test.jsonl', toJsonl(record), outputDir);

      expect(existsSync(path.join(outputDir, 'grading', 'legacy-test-id.json'))).toBe(true);
    });
  });
});
