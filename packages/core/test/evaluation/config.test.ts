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

  it('rejects removed otelFile export config', () => {
    expect(() =>
      defineConfig({
        execution: { otelFile: '.agentv/results/otel-{timestamp}.json' },
      } as never),
    ).toThrow(/execution\.otelFile has been removed/);
  });

  it('accepts all execution fields together', () => {
    const config = defineConfig({
      execution: {
        maxConcurrency: 5,
        maxRetries: 2,
        agentTimeoutMs: 120_000,
        verbose: true,
        keepWorkspaces: false,
      },
    });
    expect(config.execution).toEqual({
      maxConcurrency: 5,
      maxRetries: 2,
      agentTimeoutMs: 120_000,
      verbose: true,
      keepWorkspaces: false,
    });
  });

  it('rejects non-boolean verbose', () => {
    expect(() => defineConfig({ execution: { verbose: 'yes' } } as never)).toThrow();
  });

  it('rejects removed execution.workers', () => {
    expect(() => defineConfig({ execution: { workers: 5 } } as never)).toThrow(/workers/);
  });

  it('rejects legacy traceFile fields from typed config', () => {
    expect(() => defineConfig({ execution: { traceFile: 'trace.jsonl' } } as never)).toThrow(
      /traceFile/,
    );
  });

  it('rejects removed output.format', () => {
    expect(() => defineConfig({ output: { format: 'jsonl' } } as never)).toThrow(/format/);
  });
});
