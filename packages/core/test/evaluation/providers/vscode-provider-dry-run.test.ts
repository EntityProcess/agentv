import os from 'node:os';
import path from 'node:path';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock vscode dispatch to skip actual VS Code invocation
vi.mock('../../../src/evaluation/providers/vscode/index.js', () => ({
  dispatchAgentSession: vi.fn().mockResolvedValue({
    exitCode: 0,
    subagentName: 'subagent-1',
    responseFile: '/fake/response.md',
    tempFile: '/fake/response.tmp.md',
  }),
  dispatchBatchAgent: vi.fn().mockResolvedValue({
    exitCode: 0,
    responseFiles: ['/fake/response1.md'],
  }),
  getSubagentRoot: vi.fn().mockReturnValue('/fake/subagents'),
  provisionSubagents: vi.fn().mockResolvedValue({ created: [], skippedExisting: [] }),
}));

import { VSCodeProvider } from '../../../src/evaluation/providers/vscode-provider.js';

let tmpDir: string;
let fakeExecutable: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `agentv-test-dry-run-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  fakeExecutable = path.join(dir, 'code');
  await writeFile(fakeExecutable, '#!/bin/sh\n');
  tmpDir = dir;
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('VSCodeProvider dry-run response shape', () => {
  it('returns non-empty output so graders do not crash', async () => {
    const provider = new VSCodeProvider(
      'test',
      { executable: fakeExecutable, waitForResponse: true, dryRun: true },
      'vscode',
    );
    const response = await provider.invoke({ question: 'ping' });

    expect(response.output).toHaveLength(1);
    expect(response.output![0]!.role).toBe('assistant');
  });

  it('returns valid JSON content so is-json grader passes', async () => {
    const provider = new VSCodeProvider(
      'test',
      { executable: fakeExecutable, waitForResponse: true, dryRun: true },
      'vscode',
    );
    const response = await provider.invoke({ question: 'ping' });

    const content = response.output![0]!.content;
    expect(() => JSON.parse(content as string)).not.toThrow();
  });

  it('returns zeroed tokenUsage so execution-metrics grader does not report missing data', async () => {
    const provider = new VSCodeProvider(
      'test',
      { executable: fakeExecutable, waitForResponse: true, dryRun: true },
      'vscode',
    );
    const response = await provider.invoke({ question: 'ping' });

    expect(response.tokenUsage).toEqual({ input: 0, output: 0 });
  });

  it('batch invoke returns the same schema-valid shape per response', async () => {
    const provider = new VSCodeProvider(
      'test',
      { executable: fakeExecutable, waitForResponse: true, dryRun: true },
      'vscode',
    );
    const responses = await provider.invokeBatch!([{ question: 'ping' }]);

    expect(responses).toHaveLength(1);
    expect(responses[0]!.output).toHaveLength(1);
    expect(responses[0]!.output![0]!.role).toBe('assistant');
    expect(() => JSON.parse(responses[0]!.output![0]!.content as string)).not.toThrow();
    expect(responses[0]!.tokenUsage).toEqual({ input: 0, output: 0 });
  });
});
