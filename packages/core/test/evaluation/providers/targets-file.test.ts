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

  async function writeTargetsYaml(content: string): Promise<string> {
    tempDir = path.join(os.tmpdir(), `agentv-targets-file-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, 'targets.yaml');
    await writeFile(filePath, content);
    return filePath;
  }

  it('normalizes authored id identity and config fields', async () => {
    const filePath = await writeTargetsYaml(`targets:
  - id: candidate-agent
    provider: codex-cli
    config:
      command: ["codex"]
      model: gpt-5-codex
      reasoning_effort: low
    grader_target: grader
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
        grader_target: 'grader',
      }),
    ]);
  });

  it('rejects authored name in favor of id', async () => {
    const filePath = await writeTargetsYaml(`targets:
  - name: legacy-agent
    provider: mock
`);

    await expect(readTargetDefinitions(filePath)).rejects.toThrow(/missing a valid 'id'/);
  });

  it('rejects authored label in favor of id', async () => {
    const filePath = await writeTargetsYaml(`targets:
  - id: candidate-agent
    label: legacy-agent
    provider: mock
`);

    await expect(readTargetDefinitions(filePath)).rejects.toThrow(/Use 'id'/);
  });
});
