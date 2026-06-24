import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateRunDirectory } from '../../../src/commands/results/validate.js';

describe('results validate', () => {
  it('accepts experiment-scoped result directories without layout warnings', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(
        tempDir,
        '.agentv',
        'results',
        'with-skills',
        '2026-03-27T12-42-24-429Z',
      );
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          execution_status: 'ok',
        })}\n`,
      );
      writeFileSync(
        path.join(runDir, 'summary.json'),
        `${JSON.stringify({
          metadata: {
            timestamp: '2026-03-27T12:42:24.429Z',
            experiment: 'with-skills',
            targets: ['gpt-4o'],
            tests_run: ['test-greeting'],
          },
          run_summary: {
            'gpt-4o': {
              pass_rate: { mean: 1, stddev: 0 },
              time_seconds: { mean: 0, stddev: 0 },
              tokens: { mean: 0, stddev: 0 },
            },
          },
          timing_summary: {
            duration_ms: { mean: 0, stddev: 0 },
            total_duration_seconds: { mean: 0, stddev: 0 },
            total_tokens: { mean: 0, stddev: 0 },
            token_usage: {
              input: { mean: 0, stddev: 0 },
              output: { mean: 0, stddev: 0 },
              reasoning: { mean: 0, stddev: 0 },
            },
          },
          notes: [],
        })}\n`,
      );

      const { diagnostics } = validateRunDirectory(runDir);

      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(diagnostics.map((d) => d.message)).not.toContain(
        'Directory is not under the canonical results tree. Expected: .agentv/results/<experiment>/<timestamp>',
      );
      expect(
        diagnostics.some((d) => d.message.includes('does not match the expected pattern')),
      ).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
