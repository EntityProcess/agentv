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

  it('fails clearly on unsupported top-level environment semantics', () => {
    const output = outputPath('promptfooconfig.yaml');
    expect(() =>
      exportPromptfooConfig({
        inputPath: path.join(FIXTURE_DIR, 'environment-unsupported.agentv.yaml'),
        outputPath: output,
      }),
    ).toThrow(PromptfooExportDiagnostic);

    try {
      exportPromptfooConfig({
        inputPath: path.join(FIXTURE_DIR, 'environment-unsupported.agentv.yaml'),
        outputPath: output,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PromptfooExportDiagnostic);
      expect((error as PromptfooExportDiagnostic).code).toBe('unsupported_environment');
      expect((error as Error).message).toContain("Top-level 'environment' is AgentV-only");
    }
  });
});
