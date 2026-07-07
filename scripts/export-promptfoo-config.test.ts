import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { PromptfooExportDiagnostic, exportPromptfooConfig } from './export-promptfoo-config';

const ROOT = path.resolve(import.meta.dir, '..');
const FIXTURE_DIR = path.join(ROOT, 'scripts', 'fixtures', 'promptfoo-export');

function outputPath(name: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'agentv-promptfoo-export-')), name);
}

function parseYamlFile(filePath: string): Record<string, unknown> {
  return YAML.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
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
});
