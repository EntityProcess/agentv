import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadTestSuite } from '@agentv/core';

import { selectMultipleProviders } from '../../../src/commands/eval/targets.js';

describe('eval target selection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-target-selection-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resolves authored provider labels through providers.yaml', async () => {
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(agentvDir, { recursive: true });
    const providersPath = path.join(agentvDir, 'providers.yaml');
    await writeFile(providersPath, ['- id: mock', '  label: openai:gpt-5.4-mini', ''].join('\n'));
    const evalPath = path.join(tempDir, 'target-label.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: target-label-suite',
        'providers:',
        '  - openai:gpt-5.4-mini',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: target-case',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);
    const selections = await selectMultipleProviders({
      testFilePath: evalPath,
      repoRoot: tempDir,
      cwd: tempDir,
      explicitProvidersPath: providersPath,
      env: {},
      providerLabels: suite.targets ?? [],
      providerRefs: suite.targetRefs,
      providerSource: 'test-file',
    });

    expect(selections).toHaveLength(1);
    expect(selections[0]?.providerLabel).toBe('openai:gpt-5.4-mini');
    expect(selections[0]?.providerDisplayLabel).toBeUndefined();
    expect(selections[0]?.resolvedProvider.kind).toBe('mock');
  });

  it('uses an explicit providers.yaml catalog path', async () => {
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(agentvDir, { recursive: true });
    const providersPath = path.join(agentvDir, 'providers.yaml');
    await writeFile(
      providersPath,
      ['- id: mock', '  label: modern', '  response: modern', ''].join('\n'),
    );
    const evalPath = path.join(tempDir, 'provider-discovery.eval.yaml');
    await writeFile(
      evalPath,
      [
        'providers:',
        '  - modern',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: provider-case',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);
    const selections = await selectMultipleProviders({
      testFilePath: evalPath,
      repoRoot: tempDir,
      cwd: tempDir,
      explicitProvidersPath: providersPath,
      env: {},
      providerLabels: suite.targets ?? [],
      providerRefs: suite.targetRefs,
      providerSource: 'test-file',
    });

    expect(selections[0]?.providerLabel).toBe('modern');
    expect(selections[0]?.resolvedProvider.config.response).toBe('modern');
  });

  it('uses an explicit directory containing providers.yaml', async () => {
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(agentvDir, { recursive: true });
    await writeFile(
      path.join(agentvDir, 'providers.yaml'),
      ['- id: mock', '  label: directory-modern', '  response: directory', ''].join('\n'),
    );
    const evalPath = path.join(tempDir, 'provider-directory-discovery.eval.yaml');
    await writeFile(
      evalPath,
      [
        'providers:',
        '  - directory-modern',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: provider-case',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);
    const selections = await selectMultipleProviders({
      testFilePath: evalPath,
      repoRoot: tempDir,
      cwd: tempDir,
      explicitProvidersPath: agentvDir,
      env: {},
      providerLabels: suite.targets ?? [],
      providerRefs: suite.targetRefs,
      providerSource: 'test-file',
    });

    expect(selections[0]?.providerLabel).toBe('directory-modern');
    expect(selections[0]?.resolvedProvider.config.response).toBe('directory');
  });

  it('requires config or explicit provider catalog when requested', async () => {
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(agentvDir, { recursive: true });
    await writeFile(
      path.join(agentvDir, 'providers.yaml'),
      ['- id: mock', '  label: modern', ''].join('\n'),
    );
    const evalPath = path.join(tempDir, 'requires-config.eval.yaml');
    await writeFile(
      evalPath,
      [
        'providers:',
        '  - modern',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: provider-case',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);
    await expect(
      selectMultipleProviders({
        testFilePath: evalPath,
        repoRoot: tempDir,
        cwd: tempDir,
        requireExplicitProviderCatalog: true,
        env: {},
        providerLabels: suite.targets ?? [],
        providerRefs: suite.targetRefs,
        providerSource: 'test-file',
      }),
    ).rejects.toThrow(/Add `providers:` to \.agentv\/config\.yaml/);
  });

  it('uses provider definitions loaded from inline project config', async () => {
    const evalPath = path.join(tempDir, 'inline-providers.eval.yaml');
    await writeFile(
      evalPath,
      [
        'providers:',
        '  - inline-modern',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: provider-case',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);
    const selections = await selectMultipleProviders({
      testFilePath: evalPath,
      repoRoot: tempDir,
      cwd: tempDir,
      providerDefinitions: [
        {
          id: 'inline-modern',
          label: 'inline-modern',
          name: 'inline-modern',
          provider: 'mock',
          response: 'inline',
        },
      ],
      providerDefinitionsSource: '.agentv/config.yaml:providers',
      requireExplicitProviderCatalog: true,
      env: {},
      providerLabels: suite.targets ?? [],
      providerRefs: suite.targetRefs,
      providerSource: 'test-file',
    });

    expect(selections[0]?.providerLabel).toBe('inline-modern');
    expect(selections[0]?.providersFilePath).toBe('.agentv/config.yaml:providers');
    expect(selections[0]?.resolvedProvider.config.response).toBe('inline');
  });

  it('hard-rejects legacy targets.yaml as authored provider config', async () => {
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(agentvDir, { recursive: true });
    await writeFile(
      path.join(agentvDir, 'targets.yaml'),
      ['providers:', '  - id: mock', '    label: legacy', ''].join('\n'),
    );
    const evalPath = path.join(tempDir, 'legacy-targets.eval.yaml');
    await writeFile(
      evalPath,
      [
        'providers:',
        '  - legacy',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: provider-case',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);
    await expect(
      selectMultipleProviders({
        testFilePath: evalPath,
        repoRoot: tempDir,
        cwd: tempDir,
        env: {},
        providerLabels: suite.targets ?? [],
        providerRefs: suite.targetRefs,
        providerSource: 'test-file',
      }),
    ).rejects.toThrow(/Authored targets\.yaml files were removed.*providers\.yaml/);
  });
});
