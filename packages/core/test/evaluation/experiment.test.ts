import { describe, expect, it } from 'bun:test';

import {
  buildExperimentArtifactMetadata,
  normalizeExperimentConfig,
} from '../../src/evaluation/experiment.js';

describe('inline experiment config', () => {
  it('normalizes snake_case wire fields to camelCase runtime fields', () => {
    const config = normalizeExperimentConfig({
      name: 'baseline',
      target: 'codex-gpt5',
      targets: [{ name: 'codex-gpt5', use_target: 'codex' }],
      agent: 'codex',
      model: 'openai/gpt-5.5',
      agent_options: { reasoning_effort: 'high' },
      runs: 3,
      early_exit: false,
      timeout_seconds: 900,
      workers: 4,
      threshold: 0.8,
      budget_usd: 1.25,
      sandbox: 'auto',
      workspace: { mode: 'static', path: './workspace' },
    });

    expect(config).toMatchObject({
      name: 'baseline',
      target: 'codex-gpt5',
      targets: [{ name: 'codex-gpt5', useTarget: 'codex' }],
      agent: 'codex',
      model: 'openai/gpt-5.5',
      agentOptions: { reasoning_effort: 'high' },
      runs: 3,
      earlyExit: false,
      timeoutSeconds: 900,
      workers: 4,
      budgetUsd: 1.25,
      sandbox: 'auto',
      workspace: { mode: 'static', path: './workspace' },
    });
    expect(config.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes repeat config with legacy trial strategy parity', () => {
    const config = normalizeExperimentConfig({
      repeat: {
        count: 4,
        strategy: 'confidence_interval',
        cost_limit_usd: 0,
      },
    });

    expect(config.repeat).toEqual({
      count: 4,
      strategy: 'confidence_interval',
      costLimitUsd: 0,
    });
  });

  it('accepts the prerelease trials costLimitUsd spelling only inside repeat', () => {
    const config = normalizeExperimentConfig({
      repeat: {
        count: 2,
        costLimitUsd: 1.5,
      },
    });

    expect(config.repeat).toEqual({
      count: 2,
      strategy: 'pass_at_k',
      costLimitUsd: 1.5,
    });
  });

  it('rejects invalid run counts and sandbox values', () => {
    expect(() => normalizeExperimentConfig({ runs: 0 })).toThrow(/runs/);
    expect(() => normalizeExperimentConfig({ repeat: {} })).toThrow(/repeat.count/);
    expect(() => normalizeExperimentConfig({ repeat: { count: 2, strategy: 'median' } })).toThrow(
      /repeat.strategy/,
    );
    expect(() => normalizeExperimentConfig({ repeat: { count: 2, cost_limit_usd: -1 } })).toThrow(
      /repeat.cost_limit_usd/,
    );
    expect(() => normalizeExperimentConfig({ repeat: { count: 2 }, runs: 2 })).toThrow(
      /repeat and runs/,
    );
    expect(() => normalizeExperimentConfig({ sandbox: 'host' })).toThrow(/sandbox/);
    expect(() => normalizeExperimentConfig({ setup: [{ script: 'bun install' }] })).toThrow(
      /setup is not supported/,
    );
    expect(() => normalizeExperimentConfig({ scripts: ['bun test'] })).toThrow(
      /scripts are not supported/,
    );
  });

  it('builds safe snake_case artifact metadata without agent options', () => {
    const config = normalizeExperimentConfig({
      name: 'baseline',
      target: 'codex',
      agent_options: { secret: 'not persisted' },
      repeat: { count: 2, strategy: 'mean', cost_limit_usd: 0.5 },
      early_exit: true,
      timeout_seconds: 120,
      workers: 3,
    });

    const metadata = buildExperimentArtifactMetadata(config);

    expect(metadata).toMatchObject({
      name: 'baseline',
      target: 'codex',
      repeat: {
        count: 2,
        strategy: 'mean',
        cost_limit_usd: 0.5,
      },
      early_exit: true,
      timeout_seconds: 120,
      workers: 3,
    });
    expect(metadata).not.toHaveProperty('agent_options');
    expect(metadata).not.toHaveProperty('setup');
    expect(metadata).not.toHaveProperty('scripts');
    expect(metadata).not.toHaveProperty('source_path');
  });
});
