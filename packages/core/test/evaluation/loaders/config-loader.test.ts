import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  extractBudgetUsd,
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetRefsFromSuite,
  extractTargetsFromSuite,
  extractThreshold,
  loadConfig,
  parseExecutionDefaults,
  parseResultsConfig,
  resolveResultsConfigForProject,
} from '../../../src/evaluation/loaders/config-loader.js';
import type { JsonObject } from '../../../src/evaluation/types.js';

function withOptionalEnv(
  name: string,
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = process.env[name];
  if (value === undefined) {
    process.env[name] = undefined;
  } else {
    process.env[name] = value;
  }

  return fn().finally(() => {
    if (previous === undefined) {
      process.env[name] = undefined;
    } else {
      process.env[name] = previous;
    }
  });
}

describe('loadConfig', () => {
  it('falls back to AGENTV_HOME/config.yaml when no project-local config exists', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-global-config-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const homeDir = path.join(tempDir, 'home');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        'eval_patterns:\n  - "**/*.global.eval.yaml"\nexecution:\n  verbose: true\n',
      );

      await withOptionalEnv('AGENTV_HOME', homeDir, async () => {
        const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);
        expect(config?.eval_patterns).toEqual(['**/*.global.eval.yaml']);
        expect(config?.execution).toEqual({ verbose: true });
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prefers project-local .agentv/config.yaml over AGENTV_HOME/config.yaml', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-local-config-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      const homeDir = path.join(tempDir, 'home');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        'eval_patterns:\n  - "**/*.global.eval.yaml"\nexecution:\n  verbose: true\n',
      );
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        'eval_patterns:\n  - "**/*.local.eval.yaml"\nexecution:\n  keep_workspaces: true\n',
      );

      await withOptionalEnv('AGENTV_HOME', homeDir, async () => {
        const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);
        expect(config?.eval_patterns).toEqual(['**/*.local.eval.yaml']);
        expect(config?.execution).toEqual({ keep_workspaces: true });
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('overlays project-local .agentv/config.local.yaml on .agentv/config.yaml', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-local-config-overlay-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        [
          'eval_patterns:',
          '  - "**/*.base.eval.yaml"',
          'execution:',
          '  verbose: true',
          '  pool_slots: 2',
          'results:',
          '  path: .',
          '  branch: base-results',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(localConfigDir, 'config.local.yaml'),
        [
          'eval_patterns:',
          '  - "**/*.local.eval.yaml"',
          'execution:',
          '  keep_workspaces: true',
          '  workspace_path: /tmp/agentv-local-workspace',
          'results:',
          '  branch: local-results',
          '',
        ].join('\n'),
      );

      const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);

      expect(config?.eval_patterns).toEqual(['**/*.local.eval.yaml']);
      expect(config?.execution).toEqual({
        verbose: true,
        keep_workspaces: true,
        workspace_path: '/tmp/agentv-local-workspace',
        pool_slots: 2,
      });
      expect(config?.results).toEqual({
        mode: 'github',
        path: '.',
        branch: 'local-results',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ignores workspace runtime bindings in committed config.yaml before applying local overlays', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-local-only-workspace-'));
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        [
          'execution:',
          '  keep_workspaces: true',
          '  workspace_mode: static',
          '  workspace_path: /tmp/committed-workspace',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(localConfigDir, 'config.local.yaml'),
        ['execution:', '  verbose: true', ''].join('\n'),
      );

      const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);

      expect(config?.execution).toEqual({
        keep_workspaces: true,
        verbose: true,
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution.workspace_mode'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution.workspace_path'));
    } finally {
      warnSpy.mockRestore();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('treats project-local config.local.yaml alone as configured and does not fall back global', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-local-only-overlay-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      const homeDir = path.join(tempDir, 'home');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        'eval_patterns:\n  - "**/*.global.eval.yaml"\n',
      );
      writeFileSync(
        path.join(localConfigDir, 'config.local.yaml'),
        'execution:\n  keep_workspaces: true\n',
      );

      await withOptionalEnv('AGENTV_HOME', homeDir, async () => {
        const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);
        expect(config?.eval_patterns).toBeUndefined();
        expect(config?.execution).toEqual({ keep_workspaces: true });
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('overlays AGENTV_HOME/config.local.yaml on AGENTV_HOME/config.yaml', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-global-config-overlay-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const homeDir = path.join(tempDir, 'home');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        'execution:\n  verbose: true\n  pool_slots: 4\neval_patterns:\n  - "**/*.base.eval.yaml"\n',
      );
      writeFileSync(
        path.join(homeDir, 'config.local.yaml'),
        'execution:\n  keep_workspaces: true\neval_patterns:\n  - "**/*.local.eval.yaml"\n',
      );

      await withOptionalEnv('AGENTV_HOME', homeDir, async () => {
        const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);
        expect(config?.eval_patterns).toEqual(['**/*.local.eval.yaml']);
        expect(config?.execution).toEqual({
          verbose: true,
          keep_workspaces: true,
          pool_slots: 4,
        });
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not merge global results into project-local config', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-local-results-isolated-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      const homeDir = path.join(tempDir, 'home');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        'execution:\n  keep_workspaces: true\n',
      );
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        `results:
  mode: github
  repo: EntityProcess/global-results
`,
      );

      await withOptionalEnv('AGENTV_HOME', homeDir, async () => {
        const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);
        expect(config?.execution).toEqual({ keep_workspaces: true });
        expect(resolveResultsConfigForProject(config, 'agentv')).toBeUndefined();
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ignores removed configured experiment defaults', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-default-experiment-'));
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(path.join(localConfigDir, 'config.yaml'), 'experiments:\n  default: smoke\n');

      const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);

      expect(config).not.toHaveProperty('experiments');
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('experiments'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ignores removed top-level default_experiment shorthand', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-default-experiment-alias-'));
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(path.join(localConfigDir, 'config.yaml'), 'default_experiment: smoke\n');

      const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);

      expect(config).not.toHaveProperty('default_experiment');
      expect(
        warnSpy.mock.calls.some((call) => String(call[0]).includes('default_experiment')),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('parseResultsConfig', () => {
  it('parses valid flat results config', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        repo: 'EntityProcess/agentv-evals',
        path: '~/data/agentv-results',
        branch: 'agentv-results',
        auto_push: true,
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toEqual({
      mode: 'github',
      repo: 'EntityProcess/agentv-evals',
      path: '~/data/agentv-results',
      branch: 'agentv-results',
      auto_push: true,
    });
  });

  it('parses valid results config without path (defaults omitted)', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        repo: 'EntityProcess/agentv-evals',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toEqual({
      mode: 'github',
      repo: 'EntityProcess/agentv-evals',
    });
  });

  it('accepts missing mode for current results config', () => {
    const result = parseResultsConfig(
      {
        repo: 'EntityProcess/agentv-evals',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toEqual({
      mode: 'github',
      repo: 'EntityProcess/agentv-evals',
    });
  });

  it('parses a path-only existing local results checkout', () => {
    const result = parseResultsConfig(
      {
        path: '~/data/agentv-results',
        branch: 'agentv/results/v1',
        auto_push: false,
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toEqual({
      mode: 'github',
      path: '~/data/agentv-results',
      branch: 'agentv/results/v1',
      auto_push: false,
    });
  });

  it('parses repo and path together (existing checkout pushing to repo remote)', () => {
    const result = parseResultsConfig(
      {
        repo: 'https://github.com/example/results.git',
        path: '~/data/agentv-results',
        branch: 'agentv/results/v1',
        auto_push: true,
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toEqual({
      mode: 'github',
      repo: 'https://github.com/example/results.git',
      path: '~/data/agentv-results',
      branch: 'agentv/results/v1',
      auto_push: true,
    });
  });

  it('returns undefined when mode is not github', () => {
    const result = parseResultsConfig(
      {
        mode: 'other',
        repo: 'EntityProcess/agentv-evals',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when neither repo nor path is set', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        branch: 'agentv/results/v1',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });

  it('accepts absolute path', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        repo: 'EntityProcess/agentv-evals',
        path: '/home/user/data/results',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result?.path).toBe('/home/user/data/results');
  });

  it('returns undefined when repo is empty', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        repo: '',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when repo is not a string', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        repo: 123,
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when branch is empty', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        repo: 'EntityProcess/agentv-evals',
        branch: '',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when auto_push is not a boolean', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        repo: 'EntityProcess/agentv-evals',
        auto_push: 'yes',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });
});

describe('resolveResultsConfigForProject', () => {
  it('returns top-level results regardless of project id', () => {
    const result = resolveResultsConfigForProject(
      {
        results: { mode: 'github', repo: 'EntityProcess/fallback' },
      },
      'agentv',
    );

    expect(result?.repo).toBe('EntityProcess/fallback');
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

  it('prefers top-level target over legacy execution.target', () => {
    const suite: JsonObject = {
      target: 'top-level',
      execution: { target: 'legacy' },
    };
    expect(extractTargetFromSuite(suite)).toBe('top-level');
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

describe('extractTargetRefsFromSuite', () => {
  it('returns undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractTargetRefsFromSuite(suite)).toBeUndefined();
  });

  it('returns refs for string targets', () => {
    const suite: JsonObject = {
      execution: { targets: ['copilot', 'claude'] },
    };
    expect(extractTargetRefsFromSuite(suite)).toEqual([{ name: 'copilot' }, { name: 'claude' }]);
  });

  it('returns refs for object targets with hooks', () => {
    const suite: JsonObject = {
      execution: {
        targets: [
          { name: 'baseline' },
          {
            name: 'with-skills',
            use_target: 'default',
            hooks: {
              before_each: { command: ['setup.sh', 'skills'] },
            },
          },
        ],
      },
    };
    const refs = extractTargetRefsFromSuite(suite);
    expect(refs).toHaveLength(2);
    expect(refs?.[0]).toEqual({ name: 'baseline' });
    expect(refs?.[1]).toEqual({
      name: 'with-skills',
      use_target: 'default',
      hooks: {
        before_each: { command: ['setup.sh', 'skills'] },
      },
    });
  });

  it('handles mixed string and object targets', () => {
    const suite: JsonObject = {
      execution: {
        targets: [
          'baseline',
          {
            name: 'with-hooks',
            hooks: {
              before_each: { command: ['echo', 'hello'] },
              after_each: { command: ['echo', 'bye'] },
            },
          },
        ],
      },
    };
    const refs = extractTargetRefsFromSuite(suite);
    expect(refs).toHaveLength(2);
    expect(refs?.[0]).toEqual({ name: 'baseline' });
    expect(refs?.[1].hooks?.before_each?.command).toEqual(['echo', 'hello']);
    expect(refs?.[1].hooks?.after_each?.command).toEqual(['echo', 'bye']);
  });

  it('parses string command as shell command', () => {
    const suite: JsonObject = {
      execution: {
        targets: [
          {
            name: 'test',
            hooks: {
              before_each: { command: 'setup-plugins.sh superpowers' },
            },
          },
        ],
      },
    };
    const refs = extractTargetRefsFromSuite(suite);
    expect(refs?.[0].hooks?.before_each?.command).toEqual([
      'sh',
      '-c',
      'setup-plugins.sh superpowers',
    ]);
  });

  it('skips invalid entries', () => {
    const suite: JsonObject = {
      execution: {
        targets: ['valid', 123, null, { name: '' }, { name: 'also-valid' }],
      },
    };
    const refs = extractTargetRefsFromSuite(suite);
    expect(refs).toEqual([{ name: 'valid' }, { name: 'also-valid' }]);
  });

  it('extractTargetsFromSuite derives names from refs', () => {
    const suite: JsonObject = {
      execution: {
        targets: [
          'baseline',
          {
            name: 'with-hooks',
            use_target: 'default',
            hooks: { before_each: { command: ['ls'] } },
          },
        ],
      },
    };
    expect(extractTargetsFromSuite(suite)).toEqual(['baseline', 'with-hooks']);
  });
});

describe('extractBudgetUsd', () => {
  it('returns undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('returns undefined when no budget_usd in execution', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('parses valid budget_usd (snake_case)', () => {
    const suite: JsonObject = { execution: { budget_usd: 10.0 } };
    expect(extractBudgetUsd(suite)).toBe(10.0);
  });

  it('parses valid budgetUsd (camelCase)', () => {
    const suite: JsonObject = { execution: { budgetUsd: 5.5 } };
    expect(extractBudgetUsd(suite)).toBe(5.5);
  });

  it('returns undefined for zero budget', () => {
    const suite: JsonObject = { execution: { budget_usd: 0 } };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('returns undefined for negative budget', () => {
    const suite: JsonObject = { execution: { budget_usd: -1 } };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('returns undefined for non-number budget', () => {
    const suite: JsonObject = { execution: { budget_usd: 'ten' } };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('rejects old key total_budget_usd with a clear error', () => {
    const suite: JsonObject = { execution: { total_budget_usd: 10.0 } };
    expect(() => extractBudgetUsd(suite)).toThrow(
      'execution.total_budget_usd has been renamed to execution.budget_usd. Update your eval YAML.',
    );
  });

  it('rejects old key totalBudgetUsd with a clear error', () => {
    const suite: JsonObject = { execution: { totalBudgetUsd: 10.0 } };
    expect(() => extractBudgetUsd(suite)).toThrow(
      'execution.total_budget_usd has been renamed to execution.budget_usd. Update your eval YAML.',
    );
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

  it('parses workspace runtime bindings', () => {
    const result = parseExecutionDefaults(
      {
        workspace_mode: 'static',
        workspace_path: '  /tmp/agentv-workspace  ',
      },
      '/test/config.local.yaml',
    );
    expect(result?.workspace_mode).toBe('static');
    expect(result?.workspace_path).toBe('/tmp/agentv-workspace');
  });

  it('ignores workspace runtime bindings outside local config', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = parseExecutionDefaults(
        {
          verbose: true,
          workspace_mode: 'static',
          workspace_path: '/tmp/agentv-workspace',
        },
        '/test/config.yaml',
      );
      expect(result).toEqual({ verbose: true });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution.workspace_mode'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution.workspace_path'));
    } finally {
      warnSpy.mockRestore();
    }
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
        workspace_mode: 'temp',
        otel_file: 'otel.json',
      },
      '/test/config.local.yaml',
    );
    expect(result).toEqual({
      verbose: true,
      keep_workspaces: false,
      workspace_mode: 'temp',
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
