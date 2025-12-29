import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTargetDefinition } from '../../../src/evaluation/providers/targets.js';

describe('CLI cwd fallback to eval directory', () => {
  it('uses eval directory as fallback when cwd env var is empty', () => {
    const definition = {
      name: 'test-cli',
      provider: 'cli',
      command_template: 'echo {PROMPT}',
      cwd: '${{ EMPTY_CWD_VAR }}',
    };

    const env = {
      EMPTY_CWD_VAR: '', // Empty env var
    };

    const evalFilePath = '/path/to/evals/my-test/test.yaml';
    const resolved = resolveTargetDefinition(definition, env, evalFilePath);

    expect(resolved.kind).toBe('cli');
    if (resolved.kind === 'cli') {
      expect(resolved.config.cwd).toBe(path.resolve('/path/to/evals/my-test'));
    }
  });

  it('uses eval directory as fallback when cwd env var is undefined', () => {
    const definition = {
      name: 'test-cli',
      provider: 'cli',
      command_template: 'echo {PROMPT}',
      cwd: '${{ UNDEFINED_CWD_VAR }}',
    };

    const env = {}; // Env var not defined

    const evalFilePath = '/workspace/evals/tool-trajectory/demo.yaml';
    const resolved = resolveTargetDefinition(definition, env, evalFilePath);

    expect(resolved.kind).toBe('cli');
    if (resolved.kind === 'cli') {
      expect(resolved.config.cwd).toBe(path.resolve('/workspace/evals/tool-trajectory'));
    }
  });

  it('uses explicit cwd when env var is set and non-empty', () => {
    const definition = {
      name: 'test-cli',
      provider: 'cli',
      command_template: 'echo {PROMPT}',
      cwd: '${{ EXPLICIT_CWD }}',
    };

    const env = {
      EXPLICIT_CWD: '/custom/working/dir',
    };

    const evalFilePath = '/path/to/evals/my-test/test.yaml';
    const resolved = resolveTargetDefinition(definition, env, evalFilePath);

    expect(resolved.kind).toBe('cli');
    if (resolved.kind === 'cli') {
      expect(resolved.config.cwd).toBe('/custom/working/dir');
    }
  });

  it('does not fallback when no evalFilePath is provided', () => {
    const definition = {
      name: 'test-cli',
      provider: 'cli',
      command_template: 'echo {PROMPT}',
      cwd: '${{ MISSING_VAR }}',
    };

    const env = {};
    // No evalFilePath provided
    const resolved = resolveTargetDefinition(definition, env);

    expect(resolved.kind).toBe('cli');
    if (resolved.kind === 'cli') {
      expect(resolved.config.cwd).toBeUndefined();
    }
  });

  it('resolves relative cwd against eval directory when provided', () => {
    const definition = {
      name: 'test-cli',
      provider: 'cli',
      command_template: 'echo {PROMPT}',
      cwd: '.',
    };

    const env = {};
    const evalFilePath = '/path/to/evals/my-test/test.yaml';
    const resolved = resolveTargetDefinition(definition, env, evalFilePath);

    expect(resolved.kind).toBe('cli');
    if (resolved.kind === 'cli') {
      expect(resolved.config.cwd).toBe(path.resolve('/path/to/evals/my-test'));
    }
  });
});
