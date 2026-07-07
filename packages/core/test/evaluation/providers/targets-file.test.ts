import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readTargetDefinitions } from '../../../src/evaluation/providers/targets-file.js';

describe('readTargetDefinitions', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function writeProvidersYaml(content: string): Promise<string> {
    tempDir = path.join(os.tmpdir(), `agentv-targets-file-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, 'providers.yaml');
    await writeFile(filePath, content);
    return filePath;
  }

  it('normalizes authored provider id and label into target identity and backend fields', async () => {
    const filePath = await writeProvidersYaml(`providers:
  - id: agentv:codex-cli
    label: candidate-agent
    config:
      command: ["codex"]
      model: gpt-5-codex
      reasoning_effort: low
`);

    const definitions = await readTargetDefinitions(filePath);

    expect(definitions).toEqual([
      expect.objectContaining({
        id: 'candidate-agent',
        name: 'candidate-agent',
        label: 'candidate-agent',
        provider: 'codex-cli',
        command: ['codex'],
        model: 'gpt-5-codex',
        reasoning_effort: 'low',
      }),
    ]);
  });

  it('accepts colon provider specs and preserves unlabeled specs as stable identity', async () => {
    const filePath = await writeProvidersYaml(`providers:
  - id: openai:gpt-4.1-mini
  - id: openai:responses:gpt-5.4
    label: gpt5-responses
  - id: anthropic:messages:claude-sonnet-4-6
  - id: exec:node ./provider.js
  - id: gateway:openai:responses:gpt-5.4
  - id: openai:codex
    label: codex-sdk
  - id: openai:codex-sdk:gpt-5.4-codex
    label: codex-sdk-model
  - id: openai:codex-app-server:gpt-5.4-codex
    label: codex-local
  - id: openai:codex-desktop
`);

    const definitions = await readTargetDefinitions(filePath);

    expect(definitions).toEqual([
      expect.objectContaining({
        id: 'openai:gpt-4.1-mini',
        name: 'openai:gpt-4.1-mini',
        label: 'openai:gpt-4.1-mini',
        provider: 'openai',
        model: 'gpt-4.1-mini',
      }),
      expect.objectContaining({
        id: 'gpt5-responses',
        name: 'gpt5-responses',
        label: 'gpt5-responses',
        provider: 'openai',
        model: 'gpt-5.4',
        api_format: 'responses',
      }),
      expect.objectContaining({
        id: 'anthropic:messages:claude-sonnet-4-6',
        name: 'anthropic:messages:claude-sonnet-4-6',
        label: 'anthropic:messages:claude-sonnet-4-6',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      }),
      expect.objectContaining({
        id: 'exec:node ./provider.js',
        name: 'exec:node ./provider.js',
        label: 'exec:node ./provider.js',
        provider: 'cli',
        command: 'node ./provider.js',
      }),
      expect.objectContaining({
        id: 'gateway:openai:responses:gpt-5.4',
        name: 'gateway:openai:responses:gpt-5.4',
        label: 'gateway:openai:responses:gpt-5.4',
        provider: 'gateway',
        model: 'openai:responses:gpt-5.4',
      }),
      expect.objectContaining({
        id: 'codex-sdk',
        name: 'codex-sdk',
        label: 'codex-sdk',
        provider: 'codex-sdk',
      }),
      expect.objectContaining({
        id: 'codex-sdk-model',
        name: 'codex-sdk-model',
        label: 'codex-sdk-model',
        provider: 'codex-sdk',
        model: 'gpt-5.4-codex',
      }),
      expect.objectContaining({
        id: 'codex-local',
        name: 'codex-local',
        label: 'codex-local',
        provider: 'codex-app-server',
        model: 'gpt-5.4-codex',
      }),
      expect.objectContaining({
        id: 'openai:codex-desktop',
        name: 'openai:codex-desktop',
        label: 'openai:codex-desktop',
        provider: 'codex-app-server',
      }),
    ]);
  });

  it('rejects shell-script exec provider specs in favor of cross-platform providers', async () => {
    const filePath = await writeProvidersYaml(`providers:
  - id: exec:./script.sh
`);

    await expect(readTargetDefinitions(filePath)).rejects.toThrow(/cross-platform commands/);
  });

  it('rejects removed top-level targets', async () => {
    const filePath = await writeProvidersYaml(`targets:
  - id: candidate-agent
    provider: mock
`);

    await expect(readTargetDefinitions(filePath)).rejects.toThrow(/uses removed 'targets'/);
  });

  it('rejects authored name in favor of label', async () => {
    const filePath = await writeProvidersYaml(`providers:
  - name: legacy-agent
    id: mock
`);

    await expect(readTargetDefinitions(filePath)).rejects.toThrow(/providers\[\]\.label/);
  });

  it('rejects authored provider field in favor of id', async () => {
    const filePath = await writeProvidersYaml(`providers:
  - id: mock
    provider: mock
`);

    await expect(readTargetDefinitions(filePath)).rejects.toThrow(/providers\[\]\.id/);
  });
});
