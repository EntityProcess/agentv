import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadComposableConfigGraph } from '../../../src/evaluation/loaders/config-graph.js';
import {
  extractBudgetUsd,
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetRefsFromSuite,
  extractTargetsFromSuite,
  extractThreshold,
  extractWorkersFromSuite,
  loadConfig,
  parseExecutionDefaults,
  parseResultsConfig,
  parseTagsConfig,
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
  it('loads inline composable config graph fields from .agentv/config.yaml', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-graph-inline-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        [
          'targets:',
          '  - id: codex-local',
          '    provider: codex-app-server',
          '    runtime: host',
          '    config:',
          '      command: ["codex", "app-server"]',
          '      model: gpt-5-codex',
          'graders:',
          '  - id: openai-grader',
          '    provider: openai',
          '    config:',
          '      model: gpt-5-mini',
          'tests:',
          '  - id: smoke',
          '    input: Fix the failing test',
          'defaults:',
          '  target: codex-local',
          '  grader: openai-grader',
          'execution:',
          '  max_concurrency: 3',
          '',
        ].join('\n'),
      );

      const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);

      expect(config?.targets).toEqual([
        {
          id: 'codex-local',
          provider: 'codex-app-server',
          runtime: { mode: 'host' },
          config: { command: ['codex', 'app-server'], model: 'gpt-5-codex' },
        },
      ]);
      expect(config?.graders).toEqual([
        { id: 'openai-grader', provider: 'openai', config: { model: 'gpt-5-mini' } },
      ]);
      expect(config?.tests).toEqual([{ id: 'smoke', input: 'Fix the failing test' }]);
      expect(config?.defaults).toEqual({ target: 'codex-local', grader: 'openai-grader' });
      expect(config?.execution?.max_concurrency).toBe(3);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('normalizes split file refs the same as inline fields', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-graph-split-'));
    try {
      const inlinePath = path.join(tempDir, 'inline.eval.yaml');
      const splitPath = path.join(tempDir, 'split.eval.yaml');
      writeFileSync(
        inlinePath,
        [
          'targets:',
          '  - id: codex-local',
          '    provider: codex-app-server',
          '    runtime:',
          '      mode: profile',
          '      home: .agentv/profiles/codex-local',
          '    config:',
          '      command: ["codex"]',
          'graders:',
          '  - id: openai-grader',
          '    provider: openai',
          '    config: {}',
          'tests:',
          '  - id: smoke',
          '    input: Fix the failing test',
          'defaults:',
          '  target: codex-local',
          '  grader: openai-grader',
          'execution:',
          '  max_concurrency: 2',
          '',
        ].join('\n'),
      );
      writeFileSync(
        splitPath,
        [
          'targets: file://targets.yaml',
          'graders: file://graders.yaml',
          'tests: file://tests.yaml',
          'defaults: file://defaults.yaml',
          'execution: file://execution.yaml',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(tempDir, 'targets.yaml'),
        [
          '- id: codex-local',
          '  provider: codex-app-server',
          '  runtime:',
          '    mode: profile',
          '    home: .agentv/profiles/codex-local',
          '  config:',
          '    command: ["codex"]',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(tempDir, 'graders.yaml'),
        ['- id: openai-grader', '  provider: openai', '  config: {}', ''].join('\n'),
      );
      writeFileSync(
        path.join(tempDir, 'tests.yaml'),
        ['- id: smoke', '  input: Fix the failing test', ''].join('\n'),
      );
      writeFileSync(
        path.join(tempDir, 'defaults.yaml'),
        ['target: codex-local', 'grader: openai-grader', ''].join('\n'),
      );
      writeFileSync(path.join(tempDir, 'execution.yaml'), 'max_concurrency: 2\n');

      await expect(loadComposableConfigGraph(splitPath)).resolves.toEqual(
        await loadComposableConfigGraph(inlinePath),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('accepts sandbox runtime settings under runtime without top-level install fields', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-graph-sandbox-'));
    try {
      const configPath = path.join(tempDir, 'sandbox.eval.yaml');
      writeFileSync(
        configPath,
        [
          'targets:',
          '  - id: agent-sandbox',
          '    provider: cli',
          '    runtime:',
          '      mode: sandbox',
          '      engine: docker',
          '      image: ghcr.io/example/agent-cli:sha256',
          '      workdir: /workspace',
          '      setup:',
          '        - agent-cli --version',
          '      mounts:',
          '        - source: ./workspace',
          '          target: /workspace',
          '          access: rw',
          '        - source: ./.agentv/results',
          '          target: /results',
          '          access: rw',
          '      env:',
          '        AGENTV_RESULT_DIR: /results',
          '      secrets:',
          '        OPENAI_API_KEY: "{{ env.OPENAI_API_KEY }}"',
          '    config:',
          '      command: "agent-cli run {PROMPT_FILE} {OUTPUT_FILE}"',
          '',
        ].join('\n'),
      );

      const graph = await loadComposableConfigGraph(configPath);

      expect(graph.targets?.[0]).toEqual({
        id: 'agent-sandbox',
        provider: 'cli',
        runtime: {
          mode: 'sandbox',
          engine: 'docker',
          image: 'ghcr.io/example/agent-cli:sha256',
          workdir: '/workspace',
          setup: ['agent-cli --version'],
          mounts: [
            { source: './workspace', target: '/workspace', access: 'rw' },
            { source: './.agentv/results', target: '/results', access: 'rw' },
          ],
          env: { AGENTV_RESULT_DIR: '/results' },
          secrets: { OPENAI_API_KEY: '{{ env.OPENAI_API_KEY }}' },
        },
        config: { command: 'agent-cli run {PROMPT_FILE} {OUTPUT_FILE}' },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects wrapped referenced field files', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-graph-wrapped-'));
    try {
      const configPath = path.join(tempDir, 'config.yaml');
      writeFileSync(configPath, 'targets: file://targets.yaml\n');
      writeFileSync(
        path.join(tempDir, 'targets.yaml'),
        ['targets:', '  - id: codex-local', '    provider: codex-app-server', ''].join('\n'),
      );

      await expect(loadComposableConfigGraph(configPath)).rejects.toThrow(/wrapped in 'targets'/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('validates command arrays, defaults, max_concurrency, and removed target fields', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-graph-invalid-'));
    try {
      const invalidCases = [
        {
          name: 'command',
          yaml: [
            'targets:',
            '  - id: codex-local',
            '    provider: codex-app-server',
            '    runtime: host',
            '    config:',
            '      command: codex',
            '',
          ].join('\n'),
          message: /config\.command/,
        },
        {
          name: 'default-target',
          yaml: [
            'targets:',
            '  - id: codex-local',
            '    provider: codex-app-server',
            '    runtime: host',
            '    config: {}',
            'defaults:',
            '  target: missing',
            '',
          ].join('\n'),
          message: /defaults\.target/,
        },
        {
          name: 'concurrency',
          yaml: 'execution:\n  max_concurrency: 0\n',
          message: /max_concurrency/,
        },
        {
          name: 'execution-workers',
          yaml: 'execution:\n  workers: 2\n',
          message: /execution\.workers/,
        },
        {
          name: 'legacy-label',
          yaml: [
            'targets:',
            '  - label: codex-local',
            '    provider: codex-app-server',
            '    runtime: host',
            '    config: {}',
            '',
          ].join('\n'),
          message: /label/,
        },
        {
          name: 'bare-provider',
          yaml: [
            'targets:',
            '  - id: codex-local',
            '    provider: codex',
            '    runtime: host',
            '    config: {}',
            '',
          ].join('\n'),
          message: /ambiguous/,
        },
        {
          name: 'target-workers',
          yaml: [
            'targets:',
            '  - id: codex-local',
            '    provider: codex-app-server',
            '    runtime: host',
            '    workers: 3',
            '    config: {}',
            '',
          ].join('\n'),
          message: /workers/,
        },
        {
          name: 'target-environment',
          yaml: [
            'targets:',
            '  - id: codex-local',
            '    provider: codex-cli',
            '    runtime: host',
            '    environment:',
            '      type: host',
            '      workdir: ./workspace',
            '',
          ].join('\n'),
          message: /environment recipes belong at suite\/test\/case scope/,
        },
      ];

      for (const testCase of invalidCases) {
        const configPath = path.join(tempDir, `${testCase.name}.yaml`);
        writeFileSync(configPath, testCase.yaml);
        await expect(loadComposableConfigGraph(configPath)).rejects.toThrow(testCase.message);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

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

  it('propagates a project-config tags map through loadConfig', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-tags-config-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        'tags:\n  experiment: staging\n  team: core\n',
      );

      const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);
      expect(config?.tags).toEqual({ experiment: 'staging', team: 'core' });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('interpolates AGENTV_REPO_ROOT into project refs', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-refs-config-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        [
          'refs:',
          '  global-default: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml',
          '',
        ].join('\n'),
      );

      await withOptionalEnv('AGENTV_REPO_ROOT', undefined, async () => {
        const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);
        expect(config?.refs).toEqual({
          'global-default': `file://${projectDir}/.agentv/default-test.yaml`,
        });
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not overwrite caller-provided AGENTV_REPO_ROOT in project config interpolation', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-refs-env-config-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        ['refs:', '  global-default: file://{{ env.AGENTV_REPO_ROOT }}/default-test.yaml', ''].join(
          '\n',
        ),
      );

      await withOptionalEnv('AGENTV_REPO_ROOT', '/custom/root', async () => {
        const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);
        expect(config?.refs?.['global-default']).toBe('file:///custom/root/default-test.yaml');
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
      });
      expect(config?.results).toEqual({
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
        'execution:\n  verbose: true\neval_patterns:\n  - "**/*.base.eval.yaml"\n',
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
});

describe('parseTagsConfig', () => {
  it('parses a valid string map', () => {
    expect(
      parseTagsConfig({ experiment: 'staging', team: 'core' }, '/tmp/.agentv/config.yaml'),
    ).toEqual({
      experiment: 'staging',
      team: 'core',
    });
  });

  it('drops non-string entries and keeps the rest', () => {
    expect(
      parseTagsConfig({ experiment: 'staging', count: 3 }, '/tmp/.agentv/config.yaml'),
    ).toEqual({ experiment: 'staging' });
  });

  it('returns undefined for a non-object value', () => {
    expect(parseTagsConfig('nope', '/tmp/.agentv/config.yaml')).toBeUndefined();
    expect(parseTagsConfig(['a', 'b'], '/tmp/.agentv/config.yaml')).toBeUndefined();
  });

  it('returns undefined when nothing valid remains', () => {
    expect(parseTagsConfig({ count: 3 }, '/tmp/.agentv/config.yaml')).toBeUndefined();
    expect(parseTagsConfig(undefined, '/tmp/.agentv/config.yaml')).toBeUndefined();
  });
});

describe('parseResultsConfig', () => {
  it('parses valid flat results config', () => {
    const result = parseResultsConfig(
      {
        repo: 'EntityProcess/agentv-evals',
        path: '~/data/agentv-results',
        branch: 'agentv-results',
        auto_push: true,
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toEqual({
      repo: 'EntityProcess/agentv-evals',
      path: '~/data/agentv-results',
      branch: 'agentv-results',
      auto_push: true,
    });
  });

  it('parses valid results config without path (defaults omitted)', () => {
    const result = parseResultsConfig(
      {
        repo: 'EntityProcess/agentv-evals',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toEqual({
      repo: 'EntityProcess/agentv-evals',
    });
  });

  it('ignores legacy github mode for compatibility', () => {
    const result = parseResultsConfig(
      {
        mode: 'github',
        repo: 'EntityProcess/agentv-evals',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toEqual({
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
        branch: 'agentv/results/v1',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });

  it('accepts absolute path', () => {
    const result = parseResultsConfig(
      {
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
        repo: '',
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when repo is not a string', () => {
    const result = parseResultsConfig(
      {
        repo: 123,
      },
      '/tmp/.agentv/config.yaml',
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when branch is empty', () => {
    const result = parseResultsConfig(
      {
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
        results: { repo: 'EntityProcess/fallback' },
      },
      'agentv',
    );

    expect(result?.repo).toBe('EntityProcess/fallback');
  });
});

describe('extractTargetFromSuite', () => {
  it('extracts string target from the top level', () => {
    const suite: JsonObject = { target: 'codex-gpt5' };
    expect(extractTargetFromSuite(suite)).toBe('codex-gpt5');
  });

  it('extracts target object identity from id or extends', () => {
    const suite: JsonObject = {
      target: {
        id: 'codex-local',
        extends: 'codex-gpt5',
        config: { model: 'gpt-5.1' },
      },
    };
    expect(extractTargetFromSuite(suite)).toBe('codex-local');
  });

  it('rejects target object name in favor of id', () => {
    const suite: JsonObject = {
      target: { name: 'legacy-target', provider: 'mock' },
    };
    expect(() => extractTargetFromSuite(suite)).toThrow(/Use 'id'/);
  });

  it('rejects target object label in favor of id', () => {
    const suite: JsonObject = {
      target: { label: 'legacy-target', provider: 'mock' },
    };
    expect(() => extractTargetFromSuite(suite)).toThrow(/Use 'id'/);
  });

  it('returns undefined when no target specified', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractTargetFromSuite(suite)).toBeUndefined();
  });

  it('rejects authored top-level execution blocks', () => {
    const suite: JsonObject = { execution: { target: 'my-target' } };
    expect(() => extractTargetFromSuite(suite)).toThrow(/execution\.target/);
  });
});

describe('extractTargetsFromSuite and extractTargetRefsFromSuite', () => {
  it('return undefined when no targets are authored', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractTargetsFromSuite(suite)).toBeUndefined();
    expect(extractTargetRefsFromSuite(suite)).toBeUndefined();
  });

  it('extracts live targets strings and promptfoo-shaped target objects', () => {
    const suite: JsonObject = {
      targets: [
        'registry-agent',
        {
          id: 'inline-agent',
          provider: 'mock',
          config: { response: 'ok' },
          fallback_targets: ['registry-agent'],
        },
      ],
    };

    expect(extractTargetsFromSuite(suite)).toEqual(['registry-agent', 'inline-agent']);
    expect(extractTargetRefsFromSuite(suite)).toEqual([
      { name: 'registry-agent' },
      {
        name: 'inline-agent',
        id: 'inline-agent',
        definition: expect.objectContaining({
          id: 'inline-agent',
          name: 'inline-agent',
          label: 'inline-agent',
          provider: 'mock',
          response: 'ok',
          fallback_targets: ['registry-agent'],
        }),
      },
    ]);
  });

  it('reject top-level target arrays through execution', () => {
    const suite: JsonObject = { execution: { targets: ['copilot', 'claude'] } };
    expect(() => extractTargetsFromSuite(suite)).toThrow(/execution\.targets/);
    expect(() => extractTargetRefsFromSuite(suite)).toThrow(/execution\.targets/);
  });
});

describe('extractBudgetUsd', () => {
  it('returns undefined when no budget_usd', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('parses valid evaluate_options.budget_usd', () => {
    const suite: JsonObject = { evaluate_options: { budget_usd: 10.0 } };
    expect(extractBudgetUsd(suite)).toBe(10.0);
  });

  it('rejects removed top-level budget_usd even when evaluate_options.budget_usd is present', () => {
    const suite: JsonObject = { evaluate_options: { budget_usd: 2.5 }, budget_usd: 10.0 };
    expect(() => extractBudgetUsd(suite)).toThrow(/Top-level 'budget_usd'/);
  });

  it('rejects removed top-level budget_usd', () => {
    const suite: JsonObject = { budget_usd: 10.0 };
    expect(() => extractBudgetUsd(suite)).toThrow(/Top-level 'budget_usd'/);
  });

  it('returns undefined for zero evaluate_options budget', () => {
    const suite: JsonObject = { evaluate_options: { budget_usd: 0 } };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('returns undefined for negative evaluate_options budget', () => {
    const suite: JsonObject = { evaluate_options: { budget_usd: -1 } };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('returns undefined for non-number evaluate_options budget', () => {
    const suite: JsonObject = { evaluate_options: { budget_usd: 'ten' } };
    expect(extractBudgetUsd(suite)).toBeUndefined();
  });

  it('rejects authored execution blocks', () => {
    const suite: JsonObject = { execution: { budget_usd: 10.0 } };
    expect(() => extractBudgetUsd(suite)).toThrow(/execution\.budget_usd/);
  });
});

describe('extractWorkersFromSuite', () => {
  it('returns undefined when no max_concurrency', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractWorkersFromSuite(suite)).toBeUndefined();
  });

  it('parses valid evaluate_options.max_concurrency', () => {
    const suite: JsonObject = { evaluate_options: { max_concurrency: 5 } };
    expect(extractWorkersFromSuite(suite)).toBe(5);
  });

  it('rejects authored execution.max_concurrency', () => {
    const suite: JsonObject = { execution: { max_concurrency: 3 } };
    expect(() => extractWorkersFromSuite(suite)).toThrow(/evaluate_options\.max_concurrency/);
  });

  it('returns undefined for invalid max_concurrency', () => {
    const suite: JsonObject = { evaluate_options: { max_concurrency: 0 } };
    expect(extractWorkersFromSuite(suite)).toBeUndefined();
  });

  it('rejects authored execution blocks', () => {
    const suite: JsonObject = { execution: { workers: 5 } };
    expect(() => extractWorkersFromSuite(suite)).toThrow(/execution\.workers/);
  });
});

describe('extractFailOnError', () => {
  it('returns undefined for authored eval YAML', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractFailOnError(suite)).toBeUndefined();
  });

  it('rejects authored execution blocks', () => {
    const suite: JsonObject = { execution: { fail_on_error: true } };
    expect(() => extractFailOnError(suite)).toThrow(/execution\.fail_on_error/);
  });
});

describe('extractThreshold', () => {
  it('returns undefined when no threshold', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('parses valid top-level threshold', () => {
    const suite: JsonObject = { threshold: 0.8 };
    expect(extractThreshold(suite)).toBe(0.8);
  });

  it('accepts 0 as threshold', () => {
    const suite: JsonObject = { threshold: 0 };
    expect(extractThreshold(suite)).toBe(0);
  });

  it('accepts 1 as threshold', () => {
    const suite: JsonObject = { threshold: 1 };
    expect(extractThreshold(suite)).toBe(1);
  });

  it('returns undefined for negative threshold', () => {
    const suite: JsonObject = { threshold: -0.1 };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('returns undefined for threshold > 1', () => {
    const suite: JsonObject = { threshold: 1.5 };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('returns undefined for non-number threshold', () => {
    const suite: JsonObject = { threshold: 'high' };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('rejects authored execution blocks', () => {
    const suite: JsonObject = { execution: { threshold: 0.8 } };
    expect(() => extractThreshold(suite)).toThrow(/execution\.threshold/);
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

  it('rejects execution.workers defaults', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = parseExecutionDefaults({ workers: 4 }, '/test/config.yaml');
      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution.workers'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution.max_concurrency'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('parses keep_workspaces boolean', () => {
    const result = parseExecutionDefaults({ keep_workspaces: true }, '/test/config.yaml');
    expect(result?.keep_workspaces).toBe(true);
  });

  it('parses workspace_path and ignores removed workspace_mode', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = parseExecutionDefaults(
        {
          workspace_mode: 'static',
          workspace_path: '  /tmp/agentv-workspace  ',
        },
        '/test/config.local.yaml',
      );
      expect(result?.workspace_path).toBe('/tmp/agentv-workspace');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution.workspace_mode'));
    } finally {
      warnSpy.mockRestore();
    }
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

  it('rejects removed OTLP export fields', () => {
    expect(() =>
      parseExecutionDefaults({ otel_file: '.agentv/results/otel.json' }, '/test/config.yaml'),
    ).toThrow(/execution\.otel_file.*has been removed/);
  });

  it('parses all supported fields together', () => {
    const result = parseExecutionDefaults(
      {
        verbose: true,
        keep_workspaces: false,
      },
      '/test/config.local.yaml',
    );
    expect(result).toEqual({
      verbose: true,
      keep_workspaces: false,
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

  it('rejects all removed OTel fields together', () => {
    expect(() =>
      parseExecutionDefaults(
        {
          export_otel: true,
          otel_backend: 'langfuse',
          otel_file: 'otel.json',
          otel_capture_content: false,
          otel_group_turns: true,
        },
        '/test/config.yaml',
      ),
    ).toThrow(/execution\.otel_backend/);
  });
});
