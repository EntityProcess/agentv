import { describe, expect, it } from 'bun:test';

import { defineConfig } from '../../src/evaluation/config.js';

describe('defineConfig execution defaults', () => {
  it('accepts verbose boolean', () => {
    const config = defineConfig({ execution: { verbose: true } });
    expect(config.execution?.verbose).toBe(true);
  });

  it('accepts traceFile string', () => {
    const config = defineConfig({
      execution: { traceFile: '.agentv/results/trace-{timestamp}.jsonl' },
    });
    expect(config.execution?.traceFile).toBe('.agentv/results/trace-{timestamp}.jsonl');
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
        traceFile: 'trace.jsonl',
        keepWorkspaces: false,
        otelFile: 'otel.json',
      },
    });
    expect(config.execution).toEqual({
      workers: 5,
      maxRetries: 2,
      agentTimeoutMs: 120_000,
      verbose: true,
      traceFile: 'trace.jsonl',
      keepWorkspaces: false,
      otelFile: 'otel.json',
    });
  });

  it('rejects non-boolean verbose', () => {
    expect(() => defineConfig({ execution: { verbose: 'yes' } } as never)).toThrow();
  });

  it('rejects non-string traceFile', () => {
    expect(() => defineConfig({ execution: { traceFile: 123 } } as never)).toThrow();
  });
});
