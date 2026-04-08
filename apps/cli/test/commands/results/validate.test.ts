import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateRunDirectory } from '../../../src/commands/results/validate.js';

describe('results validate', () => {
  it('accepts experiment-scoped canonical run directories without layout warnings', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(
        tempDir,
        '.agentv',
        'results',
        'runs',
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

      const { diagnostics } = validateRunDirectory(runDir);

      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(diagnostics.map((d) => d.message)).not.toContain(
        "Directory is not under a 'runs/' tree. Expected: .agentv/results/runs/<experiment>/<run-dir>",
      );
      expect(
        diagnostics.some((d) => d.message.includes('does not match the expected pattern')),
      ).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
