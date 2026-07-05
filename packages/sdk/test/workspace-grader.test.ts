import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ScriptGraderInputSchema } from '../src/schemas.js';
import {
  createWorkspace,
  normalizeWorkspaceGraderResult,
  runWorkspaceGrader,
} from '../src/workspace.js';

function buildInput(overrides?: Record<string, unknown>) {
  return ScriptGraderInputSchema.parse({
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

  it('runs compact workspace file checks and aggregates passing checks', async () => {
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
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('4/4 checks passed.');
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every((item) => item.pass)).toBe(true);
  });

  it('scores failed file checks by passed check count', async () => {
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
    expect(result.pass).toBe(false);
    expect(result.checks.map((item) => item.pass)).toEqual([true, false, false, false]);
    expect(result.checks[1].reason).toContain('Open dashboard');
    expect(result.checks[3].reason).toContain('no such file');
  });

  it('uses AGENTV_WORKSPACE_PATH when the stdin payload omits workspacePath', async () => {
    process.env.AGENTV_WORKSPACE_PATH = tmpDir;
    writeFileSync(join(tmpDir, 'app/page.tsx'), 'Ready');

    const result = await runWorkspaceGrader(
      async ({ workspace }) => [
        {
          text: 'Workspace env fallback is exposed',
          pass: workspace.path === tmpDir,
          reason: 'Workspace path came from AGENTV_WORKSPACE_PATH.',
        },
        await workspace.file('app/page.tsx').contains('Ready'),
      ],
      buildInput(),
    );

    expect(result.score).toBe(1);
  });

  it('returns failed checks instead of requiring manual workspace path checks', async () => {
    process.env.AGENTV_WORKSPACE_PATH = undefined;

    const result = await runWorkspaceGrader(
      async ({ workspace }) => [await workspace.file('app/page.tsx').contains('Ready')],
      buildInput(),
    );

    expect(result.score).toBe(0);
    expect(result.checks[0]).toMatchObject({
      text: 'app/page.tsx contains "Ready"',
      pass: false,
    });
    expect(result.checks[0].reason).toContain('Workspace path is not available');
  });

  it('rejects file paths outside the workspace', async () => {
    const workspace = createWorkspace(buildInput({ workspacePath: tmpDir }));

    const result = await normalizeWorkspaceGraderResult([
      await workspace.file('../outside.txt').exists(),
    ]);

    expect(result.score).toBe(0);
    expect(result.checks[0].pass).toBe(false);
    expect(result.checks[0].reason).toContain('inside the workspace');
  });

  it('passes through explicit ScriptGraderResult objects', async () => {
    const result = await runWorkspaceGrader(
      () => ({
        pass: true,
        score: 0.75,
        reason: 'Custom weighted result',
        checks: [{ text: 'custom weighted result', pass: true, reason: 'Matched custom rule' }],
        details: { matched: 3, total: 4 },
      }),
      buildInput({ workspacePath: tmpDir }),
    );

    expect(result).toEqual({
      pass: true,
      score: 0.75,
      reason: 'Custom weighted result',
      checks: [{ text: 'custom weighted result', pass: true, reason: 'Matched custom rule' }],
      details: { matched: 3, total: 4 },
    });
  });
});
