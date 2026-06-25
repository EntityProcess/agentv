import { describe, expect, it } from 'bun:test';

import { defineConfig } from '../../src/evaluation/config.js';

describe('defineConfig execution defaults', () => {
  it('accepts verbose boolean', () => {
    const config = defineConfig({ execution: { verbose: true } });
    expect(config.execution?.verbose).toBe(true);
  });

  it('accepts keepWorkspaces boolean', () => {
    const config = defineConfig({ execution: { keepWorkspaces: true } });
    expect(config.execution?.keepWorkspaces).toBe(true);
  });

  it('accepts otelFile string', () => {
    const config = defineConfig({
      execution: { otelFile: '.agentv/results/otel-{timestamp}.json' },
    });
    expect(config.execution?.otelFile).toBe('.agentv/results/otel-{timestamp}.json');
  });

  it('accepts all execution fields together', () => {
    const config = defineConfig({
      execution: {
        workers: 5,
        maxRetries: 2,
        agentTimeoutMs: 120_000,
        verbose: true,
        keepWorkspaces: false,
        otelFile: 'otel.json',
      },
    });
    expect(config.execution).toEqual({
      workers: 5,
      maxRetries: 2,
      agentTimeoutMs: 120_000,
      verbose: true,
      keepWorkspaces: false,
      otelFile: 'otel.json',
    });
  });

  it('accepts typed experiment defaults', () => {
    const config = defineConfig({
      defaultExperiment: 'smoke',
      experiments: { default: 'experiments/default.exp.yaml' },
    });
    expect(config.defaultExperiment).toBe('smoke');
    expect(config.experiments?.default).toBe('experiments/default.exp.yaml');
  });

  it('rejects non-boolean verbose', () => {
    expect(() => defineConfig({ execution: { verbose: 'yes' } } as never)).toThrow();
  });

  it('drops legacy traceFile fields from typed config', () => {
    const config = defineConfig({ execution: { traceFile: 'trace.jsonl' } } as never);
    expect(config.execution).toEqual({});
  });

  it('rejects removed output.format', () => {
    expect(() => defineConfig({ output: { format: 'jsonl' } } as never)).toThrow(/format/);
  });
});
