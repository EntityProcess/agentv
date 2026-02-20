import { describe, expect, it } from 'bun:test';

import {
  extractTargetFromSuite,
  extractTargetsFromSuite,
  extractTargetsFromTestCase,
  extractTrialsConfig,
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
