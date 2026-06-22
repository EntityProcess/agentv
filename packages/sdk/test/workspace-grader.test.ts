import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CodeGraderInputSchema } from '../src/schemas.js';
import {
  createWorkspace,
  normalizeWorkspaceGraderResult,
  runWorkspaceGrader,
} from '../src/workspace.js';

function buildInput(overrides?: Record<string, unknown>) {
  return CodeGraderInputSchema.parse({
    criteria: 'Verify the workspace',
    expectedOutput: [],
    inputFiles: [],
    input: [{ role: 'user', content: 'Update the workspace' }],
    ...overrides,
  });
}

describe('workspace grader helpers', () => {
  let tmpDir: string;
  let previousWorkspaceEnv: string | undefined;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `agentv-workspace-grader-${crypto.randomUUID()}`);
    mkdirSync(join(tmpDir, 'app'), { recursive: true });
    previousWorkspaceEnv = process.env.AGENTV_WORKSPACE_PATH;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousWorkspaceEnv === undefined) {
      process.env.AGENTV_WORKSPACE_PATH = undefined;
    } else {
      process.env.AGENTV_WORKSPACE_PATH = previousWorkspaceEnv;
    }
  });

  it('runs compact workspace file assertions and aggregates passing checks', async () => {
    writeFileSync(
      join(tmpDir, 'app/page.tsx'),
      '<main>Status: All systems ready <a href="/dashboard">Open dashboard</a></main>',
    );

    const result = await runWorkspaceGrader(
      async ({ workspace }) => [
        await workspace.file('app/page.tsx').contains('Status: All systems ready'),
        await workspace.file('app/page.tsx').contains('Open dashboard'),
        await workspace.file('app/page.tsx').matches(/href=["']\/dashboard["']/),
        await workspace.file('app/page.tsx').notMatches(/TODO/i),
      ],
      buildInput({ workspacePath: tmpDir }),
    );

    expect(result.score).toBe(1);
    expect(result.assertions).toHaveLength(4);
    expect(result.assertions.every((item) => item.passed)).toBe(true);
  });

  it('scores failed file assertions by passed assertion count', async () => {
    writeFileSync(join(tmpDir, 'app/page.tsx'), '<main>Hello TODO</main>');

    const result = await runWorkspaceGrader(
      async ({ workspace }) => [
        workspace.file('app/page.tsx').contains('Hello'),
        workspace.file('app/page.tsx').contains('Open dashboard'),
        workspace.file('app/page.tsx').notMatches(/TODO/i),
        workspace.file('app/missing.tsx').contains('anything'),
      ],
      buildInput({ workspacePath: tmpDir }),
    );

    expect(result.score).toBe(0.25);
    expect(result.assertions.map((item) => item.passed)).toEqual([true, false, false, false]);
    expect(result.assertions[1].evidence).toContain('Open dashboard');
    expect(result.assertions[3].evidence).toContain('no such file');
  });

  it('uses AGENTV_WORKSPACE_PATH when the stdin payload omits workspacePath', async () => {
    process.env.AGENTV_WORKSPACE_PATH = tmpDir;
    writeFileSync(join(tmpDir, 'app/page.tsx'), 'Ready');

    const result = await runWorkspaceGrader(
      async ({ workspace }) => [
        { text: 'Workspace env fallback is exposed', passed: workspace.path === tmpDir },
        await workspace.file('app/page.tsx').contains('Ready'),
      ],
      buildInput(),
    );

    expect(result.score).toBe(1);
  });

  it('returns failed assertions instead of requiring manual workspace path checks', async () => {
    process.env.AGENTV_WORKSPACE_PATH = undefined;

    const result = await runWorkspaceGrader(
      async ({ workspace }) => [await workspace.file('app/page.tsx').contains('Ready')],
      buildInput(),
    );

    expect(result.score).toBe(0);
    expect(result.assertions[0]).toMatchObject({
      text: 'app/page.tsx contains "Ready"',
      passed: false,
    });
    expect(result.assertions[0].evidence).toContain('Workspace path is not available');
  });

  it('rejects file paths outside the workspace', async () => {
    const workspace = createWorkspace(buildInput({ workspacePath: tmpDir }));

    const result = await normalizeWorkspaceGraderResult([
      await workspace.file('../outside.txt').exists(),
    ]);

    expect(result.score).toBe(0);
    expect(result.assertions[0].passed).toBe(false);
    expect(result.assertions[0].evidence).toContain('inside the workspace');
  });

  it('passes through explicit CodeGraderResult objects', async () => {
    const result = await runWorkspaceGrader(
      () => ({
        score: 0.75,
        assertions: [{ text: 'custom weighted result', passed: true }],
        details: { matched: 3, total: 4 },
      }),
      buildInput({ workspacePath: tmpDir }),
    );

    expect(result).toEqual({
      score: 0.75,
      assertions: [{ text: 'custom weighted result', passed: true }],
      details: { matched: 3, total: 4 },
    });
  });
});
