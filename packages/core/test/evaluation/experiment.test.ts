import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  deriveExperimentNameFromPath,
  isExperimentFileReference,
  loadExperimentConfig,
  normalizeExperimentConfig,
} from '../../src/evaluation/experiment.js';

describe('experiment config', () => {
  it('normalizes snake_case wire fields to camelCase runtime fields', () => {
    const config = normalizeExperimentConfig({
      name: 'baseline',
      target: 'codex-gpt5',
      agent: 'codex',
      model: 'openai/gpt-5.5',
      agent_options: { reasoning_effort: 'high' },
      evals: 'evals/**/*.eval.yaml',
      scripts: ['build', { script: 'bun test', timeout_seconds: 120 }],
      runs: 3,
      early_exit: false,
      timeout_seconds: 900,
      sandbox: 'auto',
      setup: [{ script: 'bun install' }],
    });

    expect(config).toMatchObject({
      name: 'baseline',
      target: 'codex-gpt5',
      agent: 'codex',
      model: 'openai/gpt-5.5',
      agentOptions: { reasoning_effort: 'high' },
      evals: 'evals/**/*.eval.yaml',
      scripts: [{ script: 'build' }, { script: 'bun test', timeoutSeconds: 120 }],
      runs: 3,
      earlyExit: false,
      timeoutSeconds: 900,
      sandbox: 'auto',
      setup: [{ script: 'bun install' }],
    });
    expect(config.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('loads a YAML experiment file', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-experiment-'));
    try {
      const experimentPath = path.join(tempDir, 'default.yaml');
      writeFileSync(
        experimentPath,
        [
          'name: with-skill',
          'target: copilot',
          'agent_options:',
          '  cli_package: "@github/copilot@latest"',
          'runs: 2',
          'setup:',
          '  - script: cp skills/AGENTS.md AGENTS.md',
          '',
        ].join('\n'),
      );

      const config = await loadExperimentConfig(experimentPath);

      expect(config.name).toBe('with-skill');
      expect(config.target).toBe('copilot');
      expect(config.agentOptions).toEqual({ cli_package: '@github/copilot@latest' });
      expect(config.runs).toBe(2);
      expect(config.sourcePath).toBe(experimentPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid run counts and sandbox values', () => {
    expect(() => normalizeExperimentConfig({ runs: 0 })).toThrow(/runs/);
    expect(() => normalizeExperimentConfig({ sandbox: 'host' })).toThrow(/sandbox/);
  });

  it('detects experiment file references separately from labels', () => {
    expect(isExperimentFileReference('experiments/default.yaml')).toBe(true);
    expect(isExperimentFileReference('default.yaml')).toBe(true);
    expect(isExperimentFileReference('baseline')).toBe(false);
  });

  it('derives experiment names from file paths', () => {
    expect(deriveExperimentNameFromPath('/repo/experiments/baseline.experiment.ts')).toBe(
      'baseline',
    );
    expect(deriveExperimentNameFromPath('/repo/experiments/with-skill.yaml')).toBe('with-skill');
  });
});
