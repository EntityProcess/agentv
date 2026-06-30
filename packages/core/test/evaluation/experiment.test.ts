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
      repeat: { count: 3, strategy: 'pass_any', early_exit: false },
      timeout_seconds: 900,
      threshold: 0.8,
      budget_usd: 1.25,
    });

    expect(config).toMatchObject({
      name: 'baseline',
      target: 'codex-gpt5',
      targets: [{ name: 'codex-gpt5', useTarget: 'codex' }],
      agent: 'codex',
      model: 'openai/gpt-5.5',
      agentOptions: { reasoning_effort: 'high' },
      repeat: { count: 3, strategy: 'pass_any', earlyExit: false },
      timeoutSeconds: 900,
      budgetUsd: 1.25,
    });
    expect(config.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes repeat config', () => {
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

  it('defaults repeat strategy to pass_any', () => {
    const config = normalizeExperimentConfig({
      repeat: {
        count: 2,
      },
    });

    expect(config.repeat).toEqual({
      count: 2,
      strategy: 'pass_any',
    });
  });

  it('rejects invalid run counts', () => {
    expect(() => normalizeExperimentConfig({ runs: 3 })).toThrow(/repeat.count/);
    expect(() => normalizeExperimentConfig({ early_exit: true })).toThrow(/repeat.early_exit/);
    expect(() =>
      normalizeExperimentConfig({ repeat: { count: 2, strategy: 'pass_at_k' } }),
    ).toThrow(/pass_at_k.*removed/);
    expect(() => normalizeExperimentConfig({ repeat: {} })).toThrow(/repeat.count/);
    expect(() => normalizeExperimentConfig({ repeat: { count: 2, strategy: 'median' } })).toThrow(
      /repeat.strategy/,
    );
    expect(() => normalizeExperimentConfig({ repeat: { count: 2, cost_limit_usd: -1 } })).toThrow(
      /repeat.cost_limit_usd/,
    );
    expect(() => normalizeExperimentConfig({ repeat: { count: 2, costLimitUsd: 1 } })).toThrow(
      /repeat.costLimitUsd/,
    );
    expect(() => normalizeExperimentConfig({ setup: [{ script: 'bun install' }] })).toThrow(
      /setup is not supported/,
    );
    expect(() => normalizeExperimentConfig({ scripts: ['bun test'] })).toThrow(
      /scripts are not supported/,
    );
    expect(() => normalizeExperimentConfig({ workspace: { isolation: 'per_test' } })).toThrow(
      /Experiment workspace has been removed from eval YAML/,
    );
    expect(() =>
      normalizeExperimentConfig({ workspace: { repos: [{ repo: 'acme/support-app' }] } }),
    ).toThrow(/Experiment workspace has been removed from eval YAML/);
    expect(() => normalizeExperimentConfig({ workers: 3 })).toThrow(
      /Experiment workers has been removed from eval YAML/,
    );
  });

  it('builds safe snake_case artifact metadata without agent options', () => {
    const config = normalizeExperimentConfig({
      name: 'baseline',
      target: 'codex',
      agent_options: { secret: 'not persisted' },
      repeat: { count: 2, strategy: 'mean', early_exit: true, cost_limit_usd: 0.5 },
      timeout_seconds: 120,
    });

    const metadata = buildExperimentArtifactMetadata(config);

    expect(metadata).toMatchObject({
      name: 'baseline',
      target: 'codex',
      repeat: {
        count: 2,
        strategy: 'mean',
        early_exit: true,
        cost_limit_usd: 0.5,
      },
      timeout_seconds: 120,
    });
    expect(metadata).not.toHaveProperty('agent_options');
    expect(metadata).not.toHaveProperty('setup');
    expect(metadata).not.toHaveProperty('scripts');
    expect(metadata).not.toHaveProperty('source_path');
  });
});
