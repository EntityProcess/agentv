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
  parseEnvFromConfig,
  parseEnvPathConfig,
  parseExecutionDefaults,
  parseHooksConfig,
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
          'providers:',
          '  - id: openai:codex-app-server',
          '    label: codex-local',
          '    runtime: host',
          '    config:',
          '      command: ["codex", "app-server"]',
          '      model: gpt-5-codex',
          '  - id: openai',
          '    label: openai-grader',
          '    runtime: host',
          '    config:',
          '      model: gpt-5-mini',
          'tests:',
          '  - id: smoke',
          '    input: Fix the failing test',
          'defaults:',
          '  provider: codex-local',
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
        {
          id: 'openai-grader',
          provider: 'openai',
          runtime: { mode: 'host' },
          config: { model: 'gpt-5-mini' },
        },
      ]);
      expect(config?.tests).toEqual([{ id: 'smoke', input: 'Fix the failing test' }]);
      expect(config?.defaults).toEqual({ provider: 'codex-local', grader: 'openai-grader' });
      expect(config?.execution?.max_concurrency).toBe(3);
      expect(config?.providerDefinitions?.map((definition) => definition.name)).toEqual([
        'codex-local',
        'openai-grader',
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('records the provider catalog path for project config file refs', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-provider-path-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      const providersPath = path.join(localConfigDir, 'providers.yaml');
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        ['providers: file://providers.yaml', ''].join('\n'),
      );
      writeFileSync(providersPath, ['- id: openai', '  label: grader', ''].join('\n'));

      const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);

      expect(config?.providerCatalogPath).toBe(providersPath);
      expect(config?.providerDefinitions?.map((definition) => definition.name)).toEqual(['grader']);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps base provider catalog refs relative to config.yaml when config.local.yaml omits providers', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-provider-path-local-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const localConfigDir = path.join(projectDir, '.agentv');
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(localConfigDir, { recursive: true });
      const providersPath = path.join(localConfigDir, 'providers.yaml');
      writeFileSync(
        path.join(localConfigDir, 'config.yaml'),
        ['providers: file://providers.yaml', ''].join('\n'),
      );
      writeFileSync(
        path.join(localConfigDir, 'config.local.yaml'),
        ['execution:', '  keep_workspaces: true', ''].join('\n'),
      );
      writeFileSync(providersPath, ['- id: openai', '  label: grader', ''].join('\n'));

      const config = await loadConfig(path.join(evalDir, 'suite.eval.yaml'), projectDir);

      expect(config?.providerCatalogPath).toBe(providersPath);
      expect(config?.execution?.keep_workspaces).toBe(true);
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
          'providers:',
          '  - id: openai:codex-app-server',
          '    label: codex-local',
          '    runtime:',
          '      mode: profile',
          '      home: .agentv/profiles/codex-local',
          '    config:',
          '      command: ["codex"]',
          '  - id: openai',
          '    label: openai-grader',
          '    runtime: host',
          '    config: {}',
          'tests:',
          '  - id: smoke',
          '    input: Fix the failing test',
          'defaults:',
          '  provider: codex-local',
          '  grader: openai-grader',
          'execution:',
          '  max_concurrency: 2',
          '',
        ].join('\n'),
      );
      writeFileSync(
        splitPath,
        [
          'providers: file://providers.yaml',
          'tests: file://tests.yaml',
          'defaults: file://defaults.yaml',
          'execution: file://execution.yaml',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(tempDir, 'providers.yaml'),
        [
          '- id: openai:codex-app-server',
          '  label: codex-local',
          '  runtime:',
          '    mode: profile',
          '    home: .agentv/profiles/codex-local',
          '  config:',
          '    command: ["codex"]',
          '- id: openai',
          '  label: openai-grader',
          '  runtime: host',
          '  config: {}',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(tempDir, 'tests.yaml'),
        ['- id: smoke', '  input: Fix the failing test', ''].join('\n'),
      );
      writeFileSync(
        path.join(tempDir, 'defaults.yaml'),
        ['provider: codex-local', 'grader: openai-grader', ''].join('\n'),
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
          'providers:',
          '  - id: cli',
          '    label: agent-sandbox',
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
      writeFileSync(configPath, 'providers: file://providers.yaml\n');
      writeFileSync(
        path.join(tempDir, 'providers.yaml'),
        ['providers:', '  - id: openai:codex-app-server', '    label: codex-local', ''].join('\n'),
      );

      await expect(loadComposableConfigGraph(configPath)).rejects.toThrow(/wrapped in 'providers'/);
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
            'providers:',
            '  - id: openai:codex-app-server',
            '    label: codex-local',
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
            'providers:',
            '  - id: openai:codex-app-server',
            '    label: codex-local',
            '    runtime: host',
            '    config: {}',
            'defaults:',
            '  provider: missing',
            '',
          ].join('\n'),
          message: /defaults\.provider/,
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
            'providers:',
            '  - name: codex-local',
            '    id: openai:codex-app-server',
            '    runtime: host',
            '    config: {}',
            '',
          ].join('\n'),
          message: /label/,
        },
        {
          name: 'bare-provider',
          yaml: [
            'providers:',
            '  - id: codex',
            '    label: codex-local',
            '    runtime: host',
            '    config: {}',
            '',
          ].join('\n'),
          message: /ambiguous/,
        },
        {
          name: 'target-workers',
          yaml: [
            'providers:',
            '  - id: openai:codex-app-server',
            '    label: codex-local',
            '    runtime: host',
            '    workers: 3',
            '    config: {}',
            '',
          ].join('\n'),
          message: /workers/,
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

  it('accepts provider-local environment in config providers', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-provider-env-'));
    try {
      const configPath = path.join(tempDir, '.agentv', 'config.yaml');
      mkdirSync(path.dirname(configPath), { recursive: true });
      writeFileSync(
        configPath,
        [
          'providers:',
          '  - id: mock',
          '    label: local-mock',
          '    environment:',
          '      type: host',
          '      workdir: ./workspace',
          '',
        ].join('\n'),
      );

      const config = await loadConfig(path.join(tempDir, 'suite.eval.yaml'), tempDir);

      expect(config?.providerDefinitions?.[0]?.environment).toMatchObject({
        type: 'host',
        workdir: path.join(tempDir, '.agentv', 'workspace'),
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows defaults.provider/defaults.grader to name a provider from a separately-discovered catalog', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-graph-defaults-'));
    try {
      const configPath = path.join(tempDir, 'config.yaml');
      writeFileSync(
        configPath,
        ['defaults:', '  provider: llm', '  grader: grader', ''].join('\n'),
      );

      const config = await loadComposableConfigGraph(configPath);

      expect(config.defaults).toEqual({ provider: 'llm', grader: 'grader' });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('hard-rejects an authored graders: block — a grader is just a provider', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-graph-graders-removed-'));
    try {
      const configPath = path.join(tempDir, 'config.yaml');
      writeFileSync(
        configPath,
        [
          'providers:',
          '  - id: openai:codex-app-server',
          '    label: codex-local',
          '    runtime: host',
          '    config: {}',
          'graders:',
          '  - id: openai',
          '    label: openai-grader',
          '    config: {}',
          '',
        ].join('\n'),
      );

      await expect(loadComposableConfigGraph(configPath)).rejects.toThrow(
        /'graders' in .+ has been removed.*move each entry into 'providers'/,
      );
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
  it('rejects string target at the top level', () => {
    const suite: JsonObject = { target: 'codex-gpt5' };
    expect(() => extractTargetFromSuite(suite)).toThrow(/Use top-level 'providers'/);
  });

  it('rejects target objects at the top level', () => {
    const suite: JsonObject = {
      target: {
        id: 'codex-local',
        extends: 'codex-gpt5',
        config: { model: 'gpt-5.1' },
      },
    };
    expect(() => extractTargetFromSuite(suite)).toThrow(/Use top-level 'providers'/);
  });

  it('rejects target object name with provider migration guidance', () => {
    const suite: JsonObject = {
      target: { name: 'legacy-target', provider: 'mock' },
    };
    expect(() => extractTargetFromSuite(suite)).toThrow(/Use top-level 'providers'/);
  });

  it('rejects target object label with provider migration guidance', () => {
    const suite: JsonObject = {
      target: { label: 'legacy-target', provider: 'mock' },
    };
    expect(() => extractTargetFromSuite(suite)).toThrow(/Use top-level 'providers'/);
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
  it('return undefined when no providers are authored', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractTargetsFromSuite(suite)).toBeUndefined();
    expect(extractTargetRefsFromSuite(suite)).toBeUndefined();
  });

  it('extracts provider strings and inline provider objects as internal target refs', () => {
    const suite: JsonObject = {
      providers: [
        'registry-agent',
        {
          id: 'mock',
          label: 'inline-agent',
          config: { response: 'ok' },
        },
      ],
    };

    expect(extractTargetsFromSuite(suite)).toEqual(['registry-agent', 'inline-agent']);
    expect(extractTargetRefsFromSuite(suite)).toEqual([
      { name: 'registry-agent' },
      {
        name: 'inline-agent',
        id: 'mock',
        label: 'inline-agent',
        definition: expect.objectContaining({
          id: 'inline-agent',
          name: 'inline-agent',
          label: 'inline-agent',
          provider: 'mock',
          response: 'ok',
        }),
      },
    ]);
  });

  it('preserves colon provider specs as selection identity and lowers backend config', () => {
    const suite: JsonObject = {
      providers: [
        'openai:gpt-4.1-mini',
        {
          id: 'openai:responses:gpt-5.4',
          label: 'gpt5-responses',
        },
        {
          id: 'anthropic:messages:claude-sonnet-4-6',
        },
        {
          id: 'exec:node ./provider.js',
        },
        {
          id: 'gateway:openai:responses:gpt-5.4',
        },
        {
          id: 'openai:codex-sdk:gpt-5.4-codex',
          label: 'codex-sdk',
        },
        {
          id: 'openai:codex-app-server:gpt-5.4-codex',
          label: 'codex-local',
        },
        {
          id: 'openai:codex-desktop',
        },
      ],
    };

    expect(extractTargetsFromSuite(suite)).toEqual([
      'openai:gpt-4.1-mini',
      'gpt5-responses',
      'anthropic:messages:claude-sonnet-4-6',
      'exec:node ./provider.js',
      'gateway:openai:responses:gpt-5.4',
      'codex-sdk',
      'codex-local',
      'openai:codex-desktop',
    ]);
    expect(extractTargetRefsFromSuite(suite)).toEqual([
      { name: 'openai:gpt-4.1-mini' },
      {
        name: 'gpt5-responses',
        id: 'openai:responses:gpt-5.4',
        label: 'gpt5-responses',
        definition: expect.objectContaining({
          id: 'gpt5-responses',
          name: 'gpt5-responses',
          label: 'gpt5-responses',
          provider: 'openai',
          model: 'gpt-5.4',
          api_format: 'responses',
        }),
      },
      {
        name: 'anthropic:messages:claude-sonnet-4-6',
        id: 'anthropic:messages:claude-sonnet-4-6',
        label: 'anthropic:messages:claude-sonnet-4-6',
        definition: expect.objectContaining({
          id: 'anthropic:messages:claude-sonnet-4-6',
          name: 'anthropic:messages:claude-sonnet-4-6',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
        }),
      },
      {
        name: 'exec:node ./provider.js',
        id: 'exec:node ./provider.js',
        label: 'exec:node ./provider.js',
        definition: expect.objectContaining({
          id: 'exec:node ./provider.js',
          name: 'exec:node ./provider.js',
          provider: 'cli',
          command: 'node ./provider.js',
        }),
      },
      {
        name: 'gateway:openai:responses:gpt-5.4',
        id: 'gateway:openai:responses:gpt-5.4',
        label: 'gateway:openai:responses:gpt-5.4',
        definition: expect.objectContaining({
          id: 'gateway:openai:responses:gpt-5.4',
          name: 'gateway:openai:responses:gpt-5.4',
          provider: 'gateway',
          model: 'openai:responses:gpt-5.4',
        }),
      },
      {
        name: 'codex-sdk',
        id: 'openai:codex-sdk:gpt-5.4-codex',
        label: 'codex-sdk',
        definition: expect.objectContaining({
          id: 'codex-sdk',
          name: 'codex-sdk',
          provider: 'codex-sdk',
          model: 'gpt-5.4-codex',
        }),
      },
      {
        name: 'codex-local',
        id: 'openai:codex-app-server:gpt-5.4-codex',
        label: 'codex-local',
        definition: expect.objectContaining({
          id: 'codex-local',
          name: 'codex-local',
          provider: 'codex-app-server',
          model: 'gpt-5.4-codex',
        }),
      },
      {
        name: 'openai:codex-desktop',
        id: 'openai:codex-desktop',
        label: 'openai:codex-desktop',
        definition: expect.objectContaining({
          id: 'openai:codex-desktop',
          name: 'openai:codex-desktop',
          provider: 'codex-app-server',
        }),
      },
    ]);
  });

  it('rejects duplicate provider result identities', () => {
    const suite: JsonObject = {
      providers: [
        { id: 'mock', label: 'candidate' },
        { id: 'openai', label: 'candidate' },
      ],
    };

    expect(() => extractTargetRefsFromSuite(suite)).toThrow(/Duplicate provider identity/);
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

describe('parseHooksConfig', () => {
  it('logs a deprecation warning and still parses before_session', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = parseHooksConfig({ before_session: 'echo hi' }, '/test/config.yaml');
      expect(result).toEqual({ before_session: 'echo hi' });
      expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes('deprecated'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns undefined when before_session is absent', () => {
    expect(parseHooksConfig({}, '/test/config.yaml')).toBeUndefined();
  });
});

describe('parseEnvPathConfig', () => {
  it('normalizes a singular string into an array', () => {
    expect(parseEnvPathConfig('.env', '/test/config.yaml')).toEqual(['.env']);
  });

  it('accepts an array of strings', () => {
    expect(parseEnvPathConfig(['.env', '.env.local'], '/test/config.yaml')).toEqual([
      '.env',
      '.env.local',
    ]);
  });

  it('drops non-string entries with a warning and returns undefined when none remain', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(parseEnvPathConfig(42, '/test/config.yaml')).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('parseEnvFromConfig', () => {
  it('normalizes a singular object into an array and defaults format', () => {
    const result = parseEnvFromConfig(
      { command: ['bun', 'scripts/load-secrets.ts'] },
      '/test/config.yaml',
    );
    expect(result).toEqual([
      { command: ['bun', 'scripts/load-secrets.ts'], format: 'shell_exports' },
    ]);
  });

  it('accepts an array of entries with explicit formats', () => {
    const result = parseEnvFromConfig(
      [
        { command: ['bun', 'scripts/load-secrets.ts'], format: 'shell_exports' },
        { command: ['node', 'scripts/print-env-json.mjs'], format: 'json' },
      ],
      '/test/config.yaml',
    );
    expect(result).toEqual([
      { command: ['bun', 'scripts/load-secrets.ts'], format: 'shell_exports' },
      { command: ['node', 'scripts/print-env-json.mjs'], format: 'json' },
    ]);
  });

  it('rejects a shell command string and drops the entry', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = parseEnvFromConfig(
        { command: 'bun scripts/load-secrets.ts' },
        '/test/config.yaml',
      );
      expect(result).toBeUndefined();
      expect(
        warnSpy.mock.calls.some(([msg]) =>
          String(msg).includes('shell command strings are not supported'),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rejects an invalid format value', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = parseEnvFromConfig(
        { command: ['bun', 'x.ts'], format: 'yaml' },
        '/test/config.yaml',
      );
      expect(result).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('loadConfig env_path / env_from / configDir', () => {
  it('parses env_path and env_from and exposes the project directory (not .agentv/) as configDir', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-config-env-'));
    try {
      const projectDir = path.join(tempDir, 'project');
      const dotAgentvDir = path.join(projectDir, '.agentv');
      mkdirSync(dotAgentvDir, { recursive: true });
      writeFileSync(
        path.join(dotAgentvDir, 'config.yaml'),
        [
          'env_path:',
          '  - .env',
          '  - .env.local',
          'env_from:',
          '  - command: ["bun", "scripts/load-secrets.ts"]',
          '',
        ].join('\n'),
      );

      const config = await loadConfig(path.join(projectDir, 'evals', '_'), projectDir);

      expect(config?.env_path).toEqual(['.env', '.env.local']);
      expect(config?.env_from).toEqual([
        { command: ['bun', 'scripts/load-secrets.ts'], format: 'shell_exports' },
      ]);
      // env_path files such as `.env` sit beside `.agentv/`, at the project root.
      expect(config?.configDir).toBe(projectDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
