import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadTestSuite } from '@agentv/core';

import { selectMultipleTargets } from '../../../src/commands/eval/targets.js';

describe('eval target selection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-target-selection-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resolves authored target ids through targets.yaml', async () => {
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(agentvDir, { recursive: true });
    await writeFile(
      path.join(agentvDir, 'targets.yaml'),
      [
        '$schema: agentv-targets-v2.2',
        'targets:',
        '  - id: openai:gpt-5.4-mini',
        '    provider: mock',
        '',
      ].join('\n'),
    );
    const evalPath = path.join(tempDir, 'target-label.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: target-label-suite',
        'targets:',
        '  - id: openai:gpt-5.4-mini',
        'tests:',
        '  - id: target-case',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);
    const selections = await selectMultipleTargets({
      testFilePath: evalPath,
      repoRoot: tempDir,
      cwd: tempDir,
      env: {},
      targetNames: suite.targets ?? [],
      targetRefs: suite.targetRefs,
      targetSource: 'test-file',
    });

    expect(selections).toHaveLength(1);
    expect(selections[0]?.targetName).toBe('openai:gpt-5.4-mini');
    expect(selections[0]?.targetLabel).toBeUndefined();
    expect(selections[0]?.resolvedTarget.kind).toBe('mock');
  });
});
