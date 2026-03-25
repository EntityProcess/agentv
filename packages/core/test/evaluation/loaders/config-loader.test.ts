import { describe, expect, it } from 'bun:test';

import {
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetsFromSuite,
  extractTargetsFromTestCase,
  extractThreshold,
  extractTotalBudgetUsd,
  extractTrialsConfig,
  parseExecutionDefaults,
} from '../../../src/evaluation/loaders/config-loader.js';
import type { JsonObject } from '../../../src/evaluation/types.js';

describe('extractTrialsConfig', () => {
  it('returns undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });

  it('returns undefined when no trials in execution', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });

  it('returns undefined when count is 1', () => {
    const suite: JsonObject = { execution: { trials: { count: 1 } } };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });

  it('parses valid trials config with defaults', () => {
    const suite: JsonObject = { execution: { trials: { count: 3 } } };
    const result = extractTrialsConfig(suite);

    expect(result).toEqual({
      count: 3,
      strategy: 'pass_at_k',
      costLimitUsd: undefined,
    });
  });

  it('parses trials config with all fields', () => {
    const suite: JsonObject = {
      execution: {
        trials: {
          count: 5,
          strategy: 'mean',
          cost_limit_usd: 10.0,
        },
      },
    };
    const result = extractTrialsConfig(suite);

    expect(result).toEqual({
      count: 5,
      strategy: 'mean',
      costLimitUsd: 10.0,
    });
  });

  it('accepts confidence_interval strategy', () => {
    const suite: JsonObject = {
      execution: { trials: { count: 10, strategy: 'confidence_interval' } },
    };
    const result = extractTrialsConfig(suite);

    expect(result?.strategy).toBe('confidence_interval');
  });

  it('accepts camelCase costLimitUsd', () => {
    const suite: JsonObject = {
      execution: { trials: { count: 3, costLimitUsd: 5.0 } },
    };
    const result = extractTrialsConfig(suite);

    expect(result?.costLimitUsd).toBe(5.0);
  });

  it('returns undefined for invalid count (non-integer)', () => {
    const suite: JsonObject = { execution: { trials: { count: 2.5 } } };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });

  it('returns undefined for invalid count (zero)', () => {
    const suite: JsonObject = { execution: { trials: { count: 0 } } };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });

  it('returns undefined for invalid count (negative)', () => {
    const suite: JsonObject = { execution: { trials: { count: -1 } } };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });

  it('returns undefined for invalid count (string)', () => {
    const suite: JsonObject = { execution: { trials: { count: 'three' } } };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });

  it('defaults to pass_at_k for invalid strategy', () => {
    const suite: JsonObject = {
      execution: { trials: { count: 3, strategy: 'invalid_strategy' } },
    };
    const result = extractTrialsConfig(suite);

    expect(result?.strategy).toBe('pass_at_k');
  });

  it('ignores invalid cost_limit_usd', () => {
    const suite: JsonObject = {
      execution: { trials: { count: 3, cost_limit_usd: -5 } },
    };
    const result = extractTrialsConfig(suite);

    expect(result?.costLimitUsd).toBeUndefined();
  });

  it('ignores non-numeric cost_limit_usd', () => {
    const suite: JsonObject = {
      execution: { trials: { count: 3, cost_limit_usd: 'five' } },
    };
    const result = extractTrialsConfig(suite);

    expect(result?.costLimitUsd).toBeUndefined();
  });

  it('returns undefined when trials is not an object', () => {
    const suite: JsonObject = { execution: { trials: 'invalid' } };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });

  it('returns undefined when trials is an array', () => {
    const suite: JsonObject = { execution: { trials: [1, 2, 3] } };
    expect(extractTrialsConfig(suite)).toBeUndefined();
  });
});

describe('extractTargetFromSuite', () => {
  it('extracts target from execution.target', () => {
    const suite: JsonObject = { execution: { target: 'my-target' } };
    expect(extractTargetFromSuite(suite)).toBe('my-target');
  });

  it('falls back to root-level target', () => {
    const suite: JsonObject = { target: 'legacy-target' };
    expect(extractTargetFromSuite(suite)).toBe('legacy-target');
  });

  it('prefers execution.target over root-level target', () => {
    const suite: JsonObject = {
      target: 'legacy',
      execution: { target: 'new' },
    };
    expect(extractTargetFromSuite(suite)).toBe('new');
  });

  it('returns undefined when no target specified', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractTargetFromSuite(suite)).toBeUndefined();
  });
});

describe('extractTargetsFromSuite', () => {
  it('returns undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractTargetsFromSuite(suite)).toBeUndefined();
  });

  it('returns undefined when no targets array in execution', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(extractTargetsFromSuite(suite)).toBeUndefined();
  });

  it('extracts targets array from execution.targets', () => {
    const suite: JsonObject = {
      execution: { targets: ['copilot', 'claude'] },
    };
    expect(extractTargetsFromSuite(suite)).toEqual(['copilot', 'claude']);
  });

  it('filters out non-string entries', () => {
    const suite: JsonObject = {
      execution: { targets: ['copilot', 123, null, 'claude'] },
    };
    expect(extractTargetsFromSuite(suite)).toEqual(['copilot', 'claude']);
  });

  it('returns undefined for empty targets array', () => {
    const suite: JsonObject = {
      execution: { targets: [] },
    };
    expect(extractTargetsFromSuite(suite)).toBeUndefined();
  });

  it('trims whitespace from target names', () => {
    const suite: JsonObject = {
      execution: { targets: ['  copilot  ', 'claude  '] },
    };
    expect(extractTargetsFromSuite(suite)).toEqual(['copilot', 'claude']);
  });

  it('returns undefined when targets is not an array', () => {
    const suite: JsonObject = {
      execution: { targets: 'copilot' },
    };
    expect(extractTargetsFromSuite(suite)).toBeUndefined();
  });
});

describe('extractTargetsFromTestCase', () => {
  it('returns undefined when no execution block', () => {
    const testCase: JsonObject = { id: 'test-1' };
    expect(extractTargetsFromTestCase(testCase)).toBeUndefined();
  });

  it('extracts targets from test case execution.targets', () => {
    const testCase: JsonObject = {
      id: 'test-1',
      execution: { targets: ['copilot'] },
    };
    expect(extractTargetsFromTestCase(testCase)).toEqual(['copilot']);
  });

  it('returns undefined when targets is empty', () => {
    const testCase: JsonObject = {
      id: 'test-1',
      execution: { targets: [] },
    };
    expect(extractTargetsFromTestCase(testCase)).toBeUndefined();
  });
});

describe('extractTotalBudgetUsd', () => {
  it('returns undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractTotalBudgetUsd(suite)).toBeUndefined();
  });

  it('returns undefined when no total_budget_usd in execution', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(extractTotalBudgetUsd(suite)).toBeUndefined();
  });

  it('parses valid total_budget_usd (snake_case)', () => {
    const suite: JsonObject = { execution: { total_budget_usd: 10.0 } };
    expect(extractTotalBudgetUsd(suite)).toBe(10.0);
  });

  it('parses valid totalBudgetUsd (camelCase)', () => {
    const suite: JsonObject = { execution: { totalBudgetUsd: 5.5 } };
    expect(extractTotalBudgetUsd(suite)).toBe(5.5);
  });

  it('returns undefined for zero budget', () => {
    const suite: JsonObject = { execution: { total_budget_usd: 0 } };
    expect(extractTotalBudgetUsd(suite)).toBeUndefined();
  });

  it('returns undefined for negative budget', () => {
    const suite: JsonObject = { execution: { total_budget_usd: -1 } };
    expect(extractTotalBudgetUsd(suite)).toBeUndefined();
  });

  it('returns undefined for non-number budget', () => {
    const suite: JsonObject = { execution: { total_budget_usd: 'ten' } };
    expect(extractTotalBudgetUsd(suite)).toBeUndefined();
  });
});

describe('extractFailOnError', () => {
  it('returns undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractFailOnError(suite)).toBeUndefined();
  });

  it('returns undefined when fail_on_error not set', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(extractFailOnError(suite)).toBeUndefined();
  });

  it('returns true for fail_on_error: true', () => {
    const suite: JsonObject = { execution: { fail_on_error: true } };
    expect(extractFailOnError(suite)).toBe(true);
  });

  it('returns false for fail_on_error: false', () => {
    const suite: JsonObject = { execution: { fail_on_error: false } };
    expect(extractFailOnError(suite)).toBe(false);
  });

  it('returns undefined for numeric value', () => {
    const suite: JsonObject = { execution: { fail_on_error: 0.3 } };
    expect(extractFailOnError(suite)).toBeUndefined();
  });

  it('returns undefined for invalid string value', () => {
    const suite: JsonObject = { execution: { fail_on_error: 'always' } };
    expect(extractFailOnError(suite)).toBeUndefined();
  });

  it('supports camelCase failOnError alias', () => {
    const suite: JsonObject = { execution: { failOnError: true } };
    expect(extractFailOnError(suite)).toBe(true);
  });
});

describe('extractThreshold', () => {
  it('returns undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('returns undefined when threshold not set', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('parses valid threshold', () => {
    const suite: JsonObject = { execution: { threshold: 0.8 } };
    expect(extractThreshold(suite)).toBe(0.8);
  });

  it('accepts 0 as threshold', () => {
    const suite: JsonObject = { execution: { threshold: 0 } };
    expect(extractThreshold(suite)).toBe(0);
  });

  it('accepts 1 as threshold', () => {
    const suite: JsonObject = { execution: { threshold: 1 } };
    expect(extractThreshold(suite)).toBe(1);
  });

  it('returns undefined for negative threshold', () => {
    const suite: JsonObject = { execution: { threshold: -0.1 } };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('returns undefined for threshold > 1', () => {
    const suite: JsonObject = { execution: { threshold: 1.5 } };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('returns undefined for non-number threshold', () => {
    const suite: JsonObject = { execution: { threshold: 'high' } };
    expect(extractThreshold(suite)).toBeUndefined();
  });
});

describe('parseExecutionDefaults', () => {
  it('returns undefined when no execution block', () => {
    expect(parseExecutionDefaults(undefined, '/test/config.yaml')).toBeUndefined();
  });

  it('returns undefined when execution is not an object', () => {
    expect(parseExecutionDefaults('invalid', '/test/config.yaml')).toBeUndefined();
  });

  it('parses verbose boolean', () => {
    const result = parseExecutionDefaults({ verbose: true }, '/test/config.yaml');
    expect(result?.verbose).toBe(true);
  });

  it('parses keep_workspaces boolean', () => {
    const result = parseExecutionDefaults({ keep_workspaces: true }, '/test/config.yaml');
    expect(result?.keep_workspaces).toBe(true);
  });

  it('parses otel_file string', () => {
    const result = parseExecutionDefaults(
      { otel_file: '.agentv/results/otel.json' },
      '/test/config.yaml',
    );
    expect(result?.otel_file).toBe('.agentv/results/otel.json');
  });

  it('parses all fields together', () => {
    const result = parseExecutionDefaults(
      {
        verbose: true,
        keep_workspaces: false,
        otel_file: 'otel.json',
      },
      '/test/config.yaml',
    );
    expect(result).toEqual({
      verbose: true,
      keep_workspaces: false,
      otel_file: 'otel.json',
    });
  });

  it('ignores non-boolean verbose', () => {
    const result = parseExecutionDefaults({ verbose: 'yes' }, '/test/config.yaml');
    expect(result?.verbose).toBeUndefined();
  });

  it('returns undefined when all fields are invalid', () => {
    const result = parseExecutionDefaults({ verbose: 'yes' }, '/test/config.yaml');
    expect(result).toBeUndefined();
  });

  it('ignores unknown fields', () => {
    const result = parseExecutionDefaults(
      { verbose: true, unknown_field: 'value' },
      '/test/config.yaml',
    );
    expect(result).toEqual({ verbose: true });
  });

  it('ignores legacy trace_file fields', () => {
    const result = parseExecutionDefaults(
      { verbose: true, trace_file: '.agentv/results/trace.jsonl' },
      '/test/config.yaml',
    );
    expect(result).toEqual({ verbose: true });
  });

  it('parses export_otel boolean', () => {
    const result = parseExecutionDefaults({ export_otel: true }, '/test/config.yaml');
    expect(result?.export_otel).toBe(true);
  });

  it('ignores non-boolean export_otel', () => {
    const result = parseExecutionDefaults({ export_otel: 'yes' }, '/test/config.yaml');
    expect(result?.export_otel).toBeUndefined();
  });

  it('parses otel_backend string', () => {
    const result = parseExecutionDefaults({ otel_backend: 'langfuse' }, '/test/config.yaml');
    expect(result?.otel_backend).toBe('langfuse');
  });

  it('ignores empty otel_backend', () => {
    const result = parseExecutionDefaults({ otel_backend: '  ' }, '/test/config.yaml');
    expect(result?.otel_backend).toBeUndefined();
  });

  it('parses otel_capture_content boolean', () => {
    const result = parseExecutionDefaults({ otel_capture_content: true }, '/test/config.yaml');
    expect(result?.otel_capture_content).toBe(true);
  });

  it('parses otel_group_turns boolean', () => {
    const result = parseExecutionDefaults({ otel_group_turns: true }, '/test/config.yaml');
    expect(result?.otel_group_turns).toBe(true);
  });

  it('parses all OTel fields together', () => {
    const result = parseExecutionDefaults(
      {
        export_otel: true,
        otel_backend: 'langfuse',
        otel_file: 'otel.json',
        otel_capture_content: false,
        otel_group_turns: true,
      },
      '/test/config.yaml',
    );
    expect(result).toEqual({
      export_otel: true,
      otel_backend: 'langfuse',
      otel_file: 'otel.json',
      otel_capture_content: false,
      otel_group_turns: true,
    });
  });
});
