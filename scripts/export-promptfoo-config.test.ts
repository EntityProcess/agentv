import { describe, expect, it } from 'bun:test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { PromptfooExportDiagnostic, exportPromptfooConfig } from './export-promptfoo-config';

const ROOT = path.resolve(import.meta.dir, '..');
const FIXTURE_DIR = path.join(ROOT, 'scripts', 'fixtures', 'promptfoo-export');
const PROMPTFOO_ORACLE_VERSION = '0.121.15';
const PROMPTFOO_REFERENCE_CLONE_COMMIT = '6bfc5a0c7f16f9c4717ac731d276b578e63d0769';

function outputPath(name: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'agentv-promptfoo-export-')), name);
}

function parseYamlFile(filePath: string): Record<string, unknown> {
  return YAML.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function readJsonlFile(filePath: string): Array<Record<string, unknown>> {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function copyOraclePromptfooFiles(output: string): void {
  for (const name of ['oracle-target-provider.cjs', 'oracle-grader-provider.cjs']) {
    copyFileSync(path.join(FIXTURE_DIR, name), path.join(path.dirname(output), name));
  }
}

function runPromptfooOracle(configPath: string, outputPath: string): void {
  const result = Bun.spawnSync({
    cmd: [
      'bunx',
      `promptfoo@${PROMPTFOO_ORACLE_VERSION}`,
      'eval',
      '-c',
      configPath,
      '--no-cache',
      '--no-table',
      '--no-write',
      '-o',
      outputPath,
    ],
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      PROMPTFOO_DISABLE_UPDATE: 'true',
    },
  });

  if (!result.success) {
    throw new Error(
      [
        `promptfoo@${PROMPTFOO_ORACLE_VERSION} eval failed with exit code ${result.exitCode}`,
        result.stdout.toString(),
        result.stderr.toString(),
      ].join('\n'),
    );
  }
}

function getPath(value: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>(
    (current, key) =>
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  );
}

describe('exportPromptfooConfig', () => {
  it('preserves Promptfoo-native colon provider ids and labels', () => {
    const output = outputPath('promptfooconfig.yaml');
    exportPromptfooConfig({
      inputPath: path.join(FIXTURE_DIR, 'provider-surface.agentv.yaml'),
      outputPath: output,
    });

    const exported = parseYamlFile(output);
    const providers = exported.providers as Array<Record<string, unknown>>;

    expect(providers[0]).toMatchObject({
      id: 'openai:responses:gpt-5.4',
      label: 'responses-direct',
    });
    expect(providers[1]).toMatchObject({
      id: 'openai:codex-sdk',
      label: 'codex-sdk-direct',
    });
  });

  it('lowers agentv:codex-cli to a generated Promptfoo file provider and preserves label', () => {
    const output = outputPath('promptfooconfig.yaml');
    exportPromptfooConfig({
      inputPath: path.join(FIXTURE_DIR, 'provider-surface.agentv.yaml'),
      outputPath: output,
    });

    const exported = parseYamlFile(output);
    const providers = exported.providers as Array<Record<string, unknown>>;

    expect(providers[2]).toMatchObject({
      id: 'file://.agentv/generated/promptfoo/providers/codex-cli-provider.ts',
      label: 'codex-cli-exported',
    });
    expect(providers[2]).not.toHaveProperty('runtime');
    expect(
      existsSync(
        path.join(
          path.dirname(output),
          '.agentv',
          'generated',
          'promptfoo',
          'providers',
          'codex-cli-provider.ts',
        ),
      ),
    ).toBe(true);
  });

  it('translates AgentV snake_case config keys for Promptfoo validation', () => {
    const output = outputPath('promptfooconfig.yaml');
    exportPromptfooConfig({
      inputPath: path.join(FIXTURE_DIR, 'provider-surface.agentv.yaml'),
      outputPath: output,
    });

    const exported = parseYamlFile(output);
    expect(exported).toHaveProperty('defaultTest');
    expect(exported).toHaveProperty('evaluateOptions');
    expect(exported.evaluateOptions).toEqual({ maxConcurrency: 1 });
    expect(exported).not.toHaveProperty('default_test');
    expect(exported).not.toHaveProperty('evaluate_options');
  });

  it('lowers AgentV defaults to Promptfoo defaultTest provider selectors', () => {
    const output = outputPath('promptfooconfig.yaml');
    exportPromptfooConfig({
      inputPath: path.join(FIXTURE_DIR, 'oracle-matrix.agentv.yaml'),
      outputPath: output,
    });

    const exported = parseYamlFile(output);
    const defaultTest = exported.defaultTest as Record<string, unknown>;
    const options = defaultTest.options as Record<string, unknown>;

    expect(exported).not.toHaveProperty('defaults');
    expect(defaultTest.providers).toEqual(['target-default']);
    expect(options.provider).toBe('grader-default');
  });

  it('lowers host environment setup to a generated Promptfoo extension and workdir metadata', () => {
    const output = outputPath('promptfooconfig.yaml');
    exportPromptfooConfig({
      inputPath: path.join(FIXTURE_DIR, 'host-environment.agentv.yaml'),
      outputPath: output,
    });

    const workdir = path.resolve(FIXTURE_DIR, 'workspaces', 'provider-export');
    const exported = parseYamlFile(output);
    const providers = exported.providers as Array<Record<string, unknown>>;
    const providerConfig = providers[0]?.config as Record<string, unknown>;
    const defaultTest = exported.defaultTest as Record<string, Record<string, unknown>>;
    const metadata = exported.metadata as Record<string, unknown>;
    const extensionPath = path.join(
      path.dirname(output),
      '.agentv',
      'generated',
      'promptfoo',
      'extensions',
      'host-environment.ts',
    );

    expect(exported).not.toHaveProperty('environment');
    expect(exported.extensions).toContain(
      'file://.agentv/generated/promptfoo/extensions/host-environment.ts:beforeAll',
    );
    expect(defaultTest.vars).toMatchObject({
      locale: 'en-US',
      agentv_environment_workdir: workdir,
    });
    expect(defaultTest.metadata).toMatchObject({
      agentv_environment: { type: 'host', workdir },
    });
    expect(metadata.agentv_environment).toEqual({ type: 'host', workdir });
    expect(providerConfig.agentv_environment_workdir).toBe(workdir);
    expect(providerConfig.agentv_environment).toEqual({ type: 'host', workdir });
    expect(existsSync(extensionPath)).toBe(true);
    expect(readFileSync(extensionPath, 'utf8')).toContain('AGENTV_ENVIRONMENT_WORKDIR');
  });

  it('fails clearly on unsupported Docker environment export', () => {
    const output = outputPath('promptfooconfig.yaml');
    expect(() =>
      exportPromptfooConfig({
        inputPath: path.join(FIXTURE_DIR, 'docker-environment-unsupported.agentv.yaml'),
        outputPath: output,
      }),
    ).toThrow(PromptfooExportDiagnostic);

    try {
      exportPromptfooConfig({
        inputPath: path.join(FIXTURE_DIR, 'docker-environment-unsupported.agentv.yaml'),
        outputPath: output,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PromptfooExportDiagnostic);
      expect((error as PromptfooExportDiagnostic).code).toBe('unsupported_docker_environment');
      expect((error as Error).message).toContain('Docker environment export is not supported');
      expect((error as Error).message).toContain('isolation, image/context, mounts, services');
    }
  });

  it('executes exported Promptfoo config with deterministic matrix and grader outcomes', () => {
    const output = outputPath('promptfooconfig.yaml');
    const resultOutput = path.join(path.dirname(output), 'promptfoo-results.jsonl');
    exportPromptfooConfig({
      inputPath: path.join(FIXTURE_DIR, 'oracle-matrix.agentv.yaml'),
      outputPath: output,
    });
    copyOraclePromptfooFiles(output);

    const exported = parseYamlFile(output);
    expect(getPath(exported, ['metadata', 'agentv_promptfoo_oracle'])).toEqual({
      promptfoo_version: PROMPTFOO_ORACLE_VERSION,
      promptfoo_reference_clone_commit: PROMPTFOO_REFERENCE_CLONE_COMMIT,
    });

    runPromptfooOracle(output, resultOutput);
    const rows = readJsonlFile(resultOutput);

    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => ({
        caseId: getPath(row, ['vars', 'case_id']),
        provider: getPath(row, ['provider', 'label']),
        success: row.success,
        output: getPath(row, ['response', 'output']),
        reasons: (
          getPath(row, ['gradingResult', 'componentResults']) as Array<Record<string, unknown>>
        ).map((result) => result.reason),
      })),
    ).toEqual([
      {
        caseId: 'default-case',
        provider: 'target-default',
        success: true,
        output: 'DEFAULT:default-case',
        reasons: ['graded-by:default', 'Assertion passed'],
      },
      {
        caseId: 'test-options-case',
        provider: 'target-default',
        success: true,
        output: 'DEFAULT:test-options-case',
        reasons: ['graded-by:test-options', 'Assertion passed'],
      },
      {
        caseId: 'assertion-override-case',
        provider: 'target-override',
        success: true,
        output: 'OVERRIDE:assertion-override-case',
        reasons: ['graded-by:default', 'Assertion passed', 'graded-by:assertion'],
      },
    ]);
  }, 20000);
});
