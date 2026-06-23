import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENTV_RESULTS_ARTIFACTS_REF, addProject, saveProjectRegistry } from '@agentv/core';

import { createTagRevision } from '../../../src/commands/results/run-state.js';
import {
  createApp,
  loadResults,
  resolveDashboardMode,
  resolveSourceFile,
} from '../../../src/commands/results/serve.js';
import { assertCoreBuild } from '../../setup-core-build.js';

assertCoreBuild();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

// ── Sample JSONL content (snake_case, matching on-disk format) ──────────

const RESULT_A = {
  timestamp: '2026-03-18T10:00:01.000Z',
  test_id: 'test-greeting',
  suite: 'demo',
  score: 1.0,
  assertions: [
    { text: 'Says hello', passed: true },
    { text: 'Uses name', passed: true },
  ],
  output: [{ role: 'assistant', content: 'Hello, Alice!' }],
  target: 'gpt-4o',
  scores: [
    {
      name: 'greeting_quality',
      type: 'llm-grader',
      score: 1.0,
      assertions: [{ text: 'Says hello', passed: true }],
    },
  ],
  duration_ms: 3500,
  token_usage: { input: 1000, output: 500 },
  cost_usd: 0.015,
};

const RESULT_B = {
  timestamp: '2026-03-18T10:00:05.000Z',
  test_id: 'test-math',
  suite: 'demo',
  score: 0.5,
  assertions: [
    { text: 'Correct formula', passed: true },
    { text: 'Wrong answer', passed: false },
  ],
  target: 'gpt-4o',
  duration_ms: 1200,
  token_usage: { input: 200, output: 100 },
  cost_usd: 0.003,
};

const RESULT_EXECUTION_ERROR = {
  timestamp: '2026-03-18T10:00:07.000Z',
  test_id: 'test-provider-timeout',
  suite: 'demo',
  category: 'runtime',
  score: 0,
  assertions: [{ text: 'Execution failed before grading', passed: false }],
  target: 'gpt-4o',
  execution_status: 'execution_error',
  failure_stage: 'target',
  failure_reason_code: 'provider_timeout',
  execution_error: {
    message: 'Provider timed out',
  },
};

function toJsonl(...records: object[]): string {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

function localResultsExperimentDir(baseDir: string, experiment = 'default'): string {
  return path.join(baseDir, '.agentv', 'results', experiment);
}

function localRunDir(baseDir: string, experiment: string, timestamp: string): string {
  return path.join(localResultsExperimentDir(baseDir, experiment), timestamp);
}

function localRunDirFromRunId(baseDir: string, runId: string): string {
  const [experiment, timestamp] = runId.includes('::') ? runId.split('::') : ['default', runId];
  return localRunDir(baseDir, experiment ?? 'default', timestamp ?? runId);
}

function traceSessionEnvelope(input?: {
  runId?: string;
  testId?: string;
  target?: string;
  spanName?: string;
}): object {
  const testId = input?.testId ?? 'test-greeting';
  const target = input?.target ?? 'gpt-4o';
  return {
    schema_version: 'agentv.trace.v1',
    artifact_id: `${testId}-trace`,
    created_at: '2026-03-25T10:00:00.000Z',
    eval: {
      run_id: input?.runId ?? 'trace-run',
      test_id: testId,
      suite: 'demo',
      target,
    },
    trace: {
      format: 'otlp_openinference_spans',
      trace_id: `${testId}-trace-id`,
      root_span_id: 'root-span',
      spans: [
        {
          trace_id: `${testId}-trace-id`,
          span_id: 'root-span',
          parent_span_id: null,
          name: input?.spanName ?? 'invoke_agent gpt-4o',
          kind: 'INTERNAL',
          start_time_unix_nano: '1000000000',
          end_time_unix_nano: '1500000000',
          status: { code: 'OK' },
          attributes: {
            'gen_ai.usage.input_tokens': 7,
            'gen_ai.usage.output_tokens': 5,
          },
          events: [
            {
              name: 'agentv.score',
              time_unix_nano: '1400000000',
              attributes: {
                event_id: 'score-1',
                score: 1,
                text: 'Trace score',
                passed: true,
              },
            },
          ],
        },
      ],
    },
    source: {
      kind: 'agentv_run',
      provider: target,
      format: 'agentv_result',
      version: '1',
    },
    artifacts: {
      trace_path: 'trace.json',
    },
  };
}

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND')) {
      env[key] = value;
    }
  }
  return env;
}

function git(command: string, cwd: string): string {
  return execSync(command, { cwd, encoding: 'utf8', env: cleanGitEnv() }).trim();
}

function writeResultsConfig(
  projectDir: string,
  params: {
    readonly remote: string;
    readonly path?: string;
    readonly branch?: string;
    readonly autoPush?: boolean;
  },
): void {
  mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
  writeFileSync(
    path.join(projectDir, '.agentv', 'config.yaml'),
    `results:
  repo:
    remote: ${JSON.stringify(params.remote)}
${params.branch ? `    branch: ${JSON.stringify(params.branch)}\n` : ''}${params.path ? `    path: ${JSON.stringify(params.path)}\n` : ''}${params.autoPush !== undefined ? `  sync:\n    auto_push: ${params.autoPush}\n` : ''}`,
  );
}

function writeLegacyShorthandResultsConfig(projectDir: string, repo: string): void {
  mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
  writeFileSync(
    path.join(projectDir, '.agentv', 'config.yaml'),
    `results:
  mode: github
  repo: ${repo}
`,
  );
}

function writeLegacyGlobalShorthandResultsConfig(homeDir: string, repo: string): void {
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(
    path.join(homeDir, 'config.yaml'),
    `results:
  mode: github
  repo: ${repo}
`,
  );
}

function initializeRemoteRepo(rootDir: string): {
  remoteDir: string;
  cloneDir: string;
  seedDir: string;
} {
  const remoteDir = path.join(rootDir, 'results-remote.git');
  git(`git init --bare --initial-branch=main --quiet "${remoteDir}"`, rootDir);

  const seedDir = path.join(rootDir, 'results-seed');
  git(`git clone --quiet "${remoteDir}" "${seedDir}"`, rootDir);
  git('git config user.email "test@example.com"', seedDir);
  git('git config user.name "Test User"', seedDir);
  writeFileSync(path.join(seedDir, 'README.md'), '# results repo\n');
  git('git add README.md && git commit --quiet -m "seed repo"', seedDir);
  git('git push --quiet origin main', seedDir);

  const cloneDir = path.join(rootDir, 'results-clone');
  git(`git clone --quiet "${remoteDir}" "${cloneDir}"`, rootDir);
  git('git config user.email "test@example.com"', cloneDir);
  git('git config user.name "Test User"', cloneDir);

  return { remoteDir, cloneDir, seedDir };
}

function writeRemoteRunArtifact(
  cloneDir: string,
  experiment: string,
  timestamp: string,
  resultRecords: object | object[],
  branch = 'main',
): string {
  const isoTimestamp = timestamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
  const runDir = path.join(cloneDir, 'runs', experiment, timestamp);
  mkdirSync(runDir, { recursive: true });
  const records = Array.isArray(resultRecords) ? resultRecords : [resultRecords];
  writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(...records));
  writeFileSync(
    path.join(runDir, 'benchmark.json'),
    JSON.stringify(
      {
        metadata: {
          timestamp: isoTimestamp,
          experiment,
          targets: ['gpt-4o'],
          tests_run: ['test-greeting'],
        },
        run_summary: {
          'gpt-4o': {
            pass_rate: { mean: 1 },
          },
        },
      },
      null,
      2,
    ),
  );
  git(`git add "${runDir}" && git commit --quiet -m "add ${experiment}"`, cloneDir);
  git(`git push --quiet origin HEAD:${branch}`, cloneDir);
  git('git fetch --quiet origin --prune', cloneDir);
  return `${experiment}::${timestamp}`;
}

function writeDirtyRemoteRunArtifact(
  cloneDir: string,
  experiment: string,
  timestamp: string,
  resultRecord: object,
): string {
  const isoTimestamp = timestamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
  const runDir = path.join(cloneDir, 'runs', experiment, timestamp);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(resultRecord));
  writeFileSync(
    path.join(runDir, 'benchmark.json'),
    JSON.stringify(
      {
        metadata: {
          timestamp: isoTimestamp,
          experiment,
          targets: ['gpt-4o'],
          tests_run: ['test-greeting'],
        },
        run_summary: {
          'gpt-4o': {
            pass_rate: { mean: 1 },
          },
        },
      },
      null,
      2,
    ),
  );
  return `${experiment}::${timestamp}`;
}

function writeRemoteTagMetadataOverlay(
  repoDir: string,
  experiment: string,
  timestamp: string,
  tags: readonly string[],
): string {
  const metadataPath = path.join(repoDir, 'metadata', 'runs', experiment, timestamp, 'tags.json');
  mkdirSync(path.dirname(metadataPath), { recursive: true });
  writeFileSync(
    metadataPath,
    `${JSON.stringify({ tags, updated_at: '2026-06-06T12:00:00.000Z' }, null, 2)}\n`,
  );
  return metadataPath;
}

function writeLocalRunArtifact(
  projectDir: string,
  experiment: string,
  timestamp: string,
  resultRecord: object,
): string {
  const isoTimestamp = timestamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
  const runDir = localRunDir(projectDir, experiment, timestamp);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl({ ...resultRecord, experiment }));
  writeFileSync(
    path.join(runDir, 'benchmark.json'),
    JSON.stringify(
      {
        metadata: {
          timestamp: isoTimestamp,
          experiment,
          targets: ['gpt-4o'],
          tests_run: ['test-greeting'],
        },
        run_summary: {
          'gpt-4o': {
            pass_rate: { mean: 1 },
          },
        },
      },
      null,
      2,
    ),
  );
  return `${experiment}::${timestamp}`;
}

function writeWtgDogfoodNoncanonicalArtifact(baseDir: string): {
  runDir: string;
  indexPath: string;
} {
  const runDir = path.join(baseDir, 'wtg-dogfood-noncanonical-run');
  mkdirSync(runDir, { recursive: true });
  const indexPath = path.join(runDir, 'index.jsonl');
  writeFileSync(indexPath, toJsonl({ ...RESULT_A, test_id: 'wtg-dogfood-noncanonical' }));
  return { runDir, indexPath };
}

function runDashboardExpectFailure(args: string[], env: Record<string, string>) {
  try {
    execFileSync(process.execPath, [CLI_ENTRY, 'dashboard', ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...cleanGitEnv(),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    throw new Error('Expected dashboard command to fail');
  } catch (error) {
    const result = error as {
      status?: number;
      signal?: NodeJS.Signals | null;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      status: result.status,
      signal: result.signal,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  }
}

// ── resolveSourceFile ────────────────────────────────────────────────────

describe('resolveSourceFile', () => {
  it('rejects direct WTG dogfood run directories with setup guidance', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-serve-source-'));
    const { runDir } = writeWtgDogfoodNoncanonicalArtifact(tempDir);

    await expect(resolveSourceFile(runDir, tempDir)).rejects.toThrow(
      'Dashboard reads configured project run sources only',
    );

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects direct WTG dogfood index.jsonl manifests with setup guidance', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-serve-source-'));
    const { indexPath } = writeWtgDogfoodNoncanonicalArtifact(tempDir);

    await expect(resolveSourceFile(indexPath, tempDir)).rejects.toThrow(
      'For a one-off run bundle, use: agentv results report',
    );

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('still auto-discovers canonical project run workspaces when no source is provided', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-serve-source-'));
    const runDir = localRunDir(tempDir, 'default', '2026-06-17T00-00-00-000Z');
    mkdirSync(runDir, { recursive: true });
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(indexPath, toJsonl(RESULT_A));

    await expect(resolveSourceFile(undefined, tempDir)).resolves.toBe(indexPath);

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('dashboard CLI source contract', () => {
  it('fails before serving a WTG dogfood noncanonical run directory', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-dashboard-source-cli-'));
    const projectDir = path.join(tempDir, 'project');
    mkdirSync(projectDir, { recursive: true });
    const { runDir } = writeWtgDogfoodNoncanonicalArtifact(tempDir);

    const result = runDashboardExpectFailure(
      [runDir, '--dir', projectDir, '--single', '--port', '43117'],
      { AGENTV_HOME: path.join(tempDir, 'home') },
    );

    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).not.toContain('Serving 1 result(s)');
    expect(result.stderr).toContain('Unsupported Dashboard source');
    expect(result.stderr).toContain('agentv dashboard --dir <project-dir>');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails before serving a direct WTG dogfood index.jsonl manifest', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-dashboard-source-cli-'));
    const projectDir = path.join(tempDir, 'project');
    mkdirSync(projectDir, { recursive: true });
    const { indexPath } = writeWtgDogfoodNoncanonicalArtifact(tempDir);

    const result = runDashboardExpectFailure(
      [indexPath, '--dir', projectDir, '--single', '--port', '43118'],
      { AGENTV_HOME: path.join(tempDir, 'home') },
    );

    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).not.toContain('Serving 1 result(s)');
    expect(result.stderr).toContain('Unsupported Dashboard source');
    expect(result.stderr).toContain('agentv results report <run-workspace-or-index.jsonl>');

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── loadResults ──────────────────────────────────────────────────────────

describe('loadResults', () => {
  it('parses JSONL correctly', () => {
    const content = toJsonl(RESULT_A, RESULT_B);
    const results = loadResults(content);
    expect(results).toHaveLength(2);
    expect(results[0].testId).toBe('test-greeting');
    expect(results[1].testId).toBe('test-math');
    expect(results[0].score).toBe(1.0);
    expect(results[1].score).toBe(0.5);
  });

  it('throws on empty content', () => {
    expect(() => loadResults('')).toThrow('No valid results');
  });

  it('throws on whitespace-only content', () => {
    expect(() => loadResults('  \n  \n  ')).toThrow('No valid results');
  });
});

// ── resolveDashboardMode ───────────────────────────────────────────────

describe('resolveDashboardMode', () => {
  it('defaults to project dashboard mode when no projects are registered', () => {
    expect(resolveDashboardMode(0, {})).toEqual({
      projectDashboard: true,
    });
  });

  it('uses the project dashboard flow when exactly one project is registered', () => {
    expect(resolveDashboardMode(1, {})).toEqual({
      projectDashboard: true,
    });
  });

  it('defaults to the projects dashboard when multiple projects are registered', () => {
    expect(resolveDashboardMode(2, {})).toEqual({
      projectDashboard: true,
    });
  });

  it('forces single-project mode when --single is used', () => {
    expect(resolveDashboardMode(3, { single: true })).toEqual({
      projectDashboard: false,
    });
  });
});

// ── Mock studio dist ─────────────────────────────────────────────────────

const MOCK_STUDIO_HTML = `<!doctype html>
<html lang="en" class="dark">
<head><title>agentv</title></head>
<body class="bg-gray-950 text-gray-100"><div id="root"></div></body>
</html>`;

function createMockStudioDir(baseDir: string): string {
  const studioDir = path.join(baseDir, 'studio-dist');
  mkdirSync(studioDir, { recursive: true });
  writeFileSync(path.join(studioDir, 'index.html'), MOCK_STUDIO_HTML);
  return studioDir;
}

// ── Hono app (Dashboard SPA + API) ─────────────────────────────────────────

describe('serve app', () => {
  let tempDir: string;
  let studioDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-serve-test-'));
    studioDir = createMockStudioDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeApp() {
    const content = toJsonl(RESULT_A, RESULT_B);
    const results = loadResults(content);
    return createApp(results, tempDir, undefined, undefined, { studioDir });
  }

  // ── createApp throws without studio dist ──────────────────────────────

  describe('createApp', () => {
    it('throws when studio dist is not found', () => {
      expect(() =>
        createApp([], tempDir, undefined, undefined, { studioDir: '/nonexistent/path' }),
      ).toThrow('Dashboard dist not found');
    });
  });

  // ── GET / ──────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('serves Dashboard SPA index.html', async () => {
      const app = makeApp();
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('agentv');
      expect(html).toContain('<div id="root">');
    });
  });

  // ── GET /api/filesystem/browse ────────────────────────────────────────

  describe('GET /api/filesystem/browse', () => {
    it('lists child directories and marks AgentV project folders', async () => {
      const projectDir = path.join(tempDir, 'project-with-agentv');
      const bareDir = path.join(tempDir, 'plain-folder');
      mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
      mkdirSync(bareDir, { recursive: true });
      writeFileSync(path.join(tempDir, 'not-a-folder.txt'), 'ignored');

      const app = makeApp();
      const res = await app.request(`/api/filesystem/browse?path=${encodeURIComponent(tempDir)}`);

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        path: string;
        parent_path?: string;
        current: { name: string; path: string; has_agentv: boolean };
        entries: Array<{ name: string; path: string; has_agentv: boolean }>;
      };
      expect(data.path).toBe(tempDir);
      expect(data.parent_path).toBe(path.dirname(tempDir));
      expect(data.current).toMatchObject({
        name: path.basename(tempDir),
        path: tempDir,
        has_agentv: false,
      });
      expect(data.entries).toEqual([
        { name: 'project-with-agentv', path: projectDir, has_agentv: true },
        { name: 'plain-folder', path: bareDir, has_agentv: false },
        { name: 'studio-dist', path: studioDir, has_agentv: false },
      ]);
    });

    it('returns an understandable error for non-directory paths', async () => {
      const filePath = path.join(tempDir, 'not-a-folder.txt');
      writeFileSync(filePath, 'not a directory');

      const app = makeApp();
      const res = await app.request(`/api/filesystem/browse?path=${encodeURIComponent(filePath)}`);

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain('Not a directory');
      expect(data.error).toContain(filePath);
    });
  });

  // ── POST /api/projects ────────────────────────────────────────────────

  describe('POST /api/projects', () => {
    it('registers a selected AgentV project directory', async () => {
      const previousHome = process.env.AGENTV_HOME;
      process.env.AGENTV_HOME = path.join(tempDir, 'agentv-home-register');

      try {
        const projectDir = path.join(tempDir, 'project-to-register');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });

        const app = makeApp();
        const create = await app.request('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: projectDir }),
        });

        expect(create.status).toBe(201);
        const created = (await create.json()) as {
          id: string;
          name: string;
          path: string;
          added_at: string;
          last_opened_at: string;
        };
        expect(created).toMatchObject({
          id: 'project-to-register',
          name: 'project-to-register',
          path: projectDir,
        });
        expect(created.added_at).toBeTruthy();
        expect(created.last_opened_at).toBeTruthy();

        const list = await app.request('/api/projects');
        const data = (await list.json()) as { projects: Array<{ id: string; path: string }> };
        expect(data.projects).toEqual([
          expect.objectContaining({ id: 'project-to-register', path: projectDir }),
        ]);
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    });
  });

  // ── DELETE /api/projects/:projectId ───────────────────────────────────

  describe('DELETE /api/projects/:projectId', () => {
    it('unregisters a project without deleting its directory', async () => {
      const previousHome = process.env.AGENTV_HOME;
      process.env.AGENTV_HOME = path.join(tempDir, 'agentv-home-remove');

      try {
        const projectDir = path.join(tempDir, 'project-to-remove');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        const entry = addProject(projectDir);

        const app = makeApp();
        const remove = await app.request(`/api/projects/${encodeURIComponent(entry.id)}`, {
          method: 'DELETE',
        });

        expect(remove.status).toBe(200);
        expect(await remove.json()).toEqual({ ok: true });
        expect(existsSync(projectDir)).toBe(true);
        expect(existsSync(path.join(projectDir, '.agentv'))).toBe(true);

        const list = await app.request('/api/projects');
        const data = (await list.json()) as { projects: Array<{ id: string }> };
        expect(data.projects).toEqual([]);
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    });
  });

  // ── GET /api/feedback ──────────────────────────────────────────────────

  describe('GET /api/feedback', () => {
    it('returns empty reviews when no feedback file', async () => {
      const app = makeApp();
      const res = await app.request('/api/feedback');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ reviews: [] });
    });
  });

  // ── POST /api/feedback ─────────────────────────────────────────────────

  describe('POST /api/feedback', () => {
    it('persists reviews to feedback.json', async () => {
      const app = makeApp();
      const res = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ test_id: 'test-greeting', comment: 'Looks good!' }],
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        reviews: { test_id: string; comment: string; updated_at: string }[];
      };
      expect(data.reviews).toHaveLength(1);
      expect(data.reviews[0].test_id).toBe('test-greeting');
      expect(data.reviews[0].comment).toBe('Looks good!');
      expect(data.reviews[0].updated_at).toBeDefined();

      // Verify file exists on disk
      const fp = path.join(tempDir, 'feedback.json');
      expect(existsSync(fp)).toBe(true);
      const onDisk = JSON.parse(readFileSync(fp, 'utf8'));
      expect(onDisk.reviews).toHaveLength(1);
    });

    it('merges with existing reviews', async () => {
      const app = makeApp();

      // First review
      await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ test_id: 'test-greeting', comment: 'First review' }],
        }),
      });

      // Second review (different test_id)
      const res = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ test_id: 'test-math', comment: 'Math looks off' }],
        }),
      });

      const data = (await res.json()) as { reviews: { test_id: string }[] };
      expect(data.reviews).toHaveLength(2);
      expect(data.reviews.map((r: { test_id: string }) => r.test_id).sort()).toEqual([
        'test-greeting',
        'test-math',
      ]);
    });

    it('overwrites duplicate test_id', async () => {
      const app = makeApp();

      // First review
      await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ test_id: 'test-greeting', comment: 'Initial' }],
        }),
      });

      // Overwrite same test_id
      const res = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ test_id: 'test-greeting', comment: 'Updated' }],
        }),
      });

      const data = (await res.json()) as { reviews: { test_id: string; comment: string }[] };
      expect(data.reviews).toHaveLength(1);
      expect(data.reviews[0].comment).toBe('Updated');
    });

    it('accepts empty comment string', async () => {
      const app = makeApp();
      const res = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ test_id: 'test-greeting', comment: '' }],
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        reviews: { comment: string }[];
      };
      expect(data.reviews[0].comment).toBe('');
    });

    it('rejects invalid payload (400)', async () => {
      const app = makeApp();

      // Missing reviews array
      const res1 = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      });
      expect(res1.status).toBe(400);

      // Invalid review entry
      const res2 = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: [{ test_id: 123 }] }),
      });
      expect(res2.status).toBe(400);

      // Not an object
      const res3 = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '"just a string"',
      });
      expect(res3.status).toBe(400);
    });

    it('returns 403 in read-only mode', async () => {
      const content = toJsonl(RESULT_A, RESULT_B);
      const results = loadResults(content);
      const app = createApp(results, tempDir, undefined, undefined, {
        studioDir,
        readOnly: true,
      });

      const res = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ test_id: 'test-greeting', comment: 'blocked' }],
        }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/config', () => {
    it('includes read_only mode and dashboard mode in the config payload', async () => {
      const content = toJsonl(RESULT_A, RESULT_B);
      const results = loadResults(content);
      const app = createApp(results, tempDir, undefined, undefined, {
        studioDir,
        readOnly: true,
        projectDashboard: true,
      });

      const res = await app.request('/api/config');
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        read_only?: boolean;
        project_dashboard?: boolean;
      };
      expect(data.read_only).toBe(true);
      expect(data.project_dashboard).toBe(true);
    });
  });

  // ── Empty state (no results) ────────────────────────────────────────

  describe('empty state', () => {
    it('serves Dashboard SPA with empty results', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('agentv');
    });

    it('serves feedback API with empty results', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/feedback');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ reviews: [] });
    });
  });

  // ── GET /api/runs ───────────────────────────────────────────────────

  describe('GET /api/runs', () => {
    function createLocalRun(baseDir: string, filename: string, ...records: object[]) {
      const runDir = localRunDir(baseDir, 'default', filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(...records));
    }

    it('returns empty runs list for temp directory', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/runs');
      expect(res.status).toBe(200);
      const data = (await res.json()) as { runs: unknown[] };
      expect(data.runs).toEqual([]);
    });

    it('supports cursor pagination when limit is provided', async () => {
      createLocalRun(tempDir, '2026-03-25T10-00-00-000Z', RESULT_A);
      createLocalRun(tempDir, '2026-03-25T11-00-00-000Z', RESULT_A);
      createLocalRun(tempDir, '2026-03-25T12-00-00-000Z', RESULT_A);

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const firstRes = await app.request('/api/runs?limit=2');
      expect(firstRes.status).toBe(200);
      const firstPage = (await firstRes.json()) as {
        runs: Array<{ filename: string }>;
        next_cursor?: string;
      };
      expect(firstPage.runs.map((run) => run.filename)).toEqual([
        '2026-03-25T12-00-00-000Z',
        '2026-03-25T11-00-00-000Z',
      ]);
      expect(firstPage.next_cursor).toBe('2026-03-25T11-00-00-000Z');

      const secondRes = await app.request(
        `/api/runs?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor ?? '')}`,
      );
      expect(secondRes.status).toBe(200);
      const secondPage = (await secondRes.json()) as {
        runs: Array<{ filename: string }>;
        next_cursor?: string;
      };
      expect(secondPage.runs.map((run) => run.filename)).toEqual(['2026-03-25T10-00-00-000Z']);
      expect(secondPage.next_cursor).toBeUndefined();
    });

    it('sorts runs by displayed timestamp descending before pagination', async () => {
      createLocalRun(tempDir, 'z-older-directory-name', {
        ...RESULT_A,
        timestamp: '2026-03-25T10:00:00.000Z',
      });
      createLocalRun(tempDir, 'a-newer-directory-name', {
        ...RESULT_A,
        timestamp: '2026-03-25T10:09:00.000Z',
      });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const res = await app.request('/api/runs?limit=1');
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        runs: Array<{ filename: string; timestamp: string }>;
        next_cursor?: string;
      };
      expect(data.runs.map(({ filename, timestamp }) => ({ filename, timestamp }))).toEqual([
        {
          filename: 'a-newer-directory-name',
          timestamp: '2026-03-25T10:09:00.000Z',
        },
      ]);
      expect(data.next_cursor).toBe('a-newer-directory-name');
    });

    it('returns an empty page for unknown cursors', async () => {
      createLocalRun(tempDir, '2026-03-25T10-00-00-000Z', RESULT_A);
      createLocalRun(tempDir, '2026-03-25T11-00-00-000Z', RESULT_A);

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request('/api/runs?limit=1&cursor=missing-run');

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        runs: Array<{ filename: string }>;
        next_cursor?: string;
      };
      expect(data.runs).toEqual([]);
      expect(data.next_cursor).toBeUndefined();
    });

    it('rejects invalid pagination limits', async () => {
      createLocalRun(tempDir, '2026-03-25T10-00-00-000Z', RESULT_A);

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request('/api/runs?limit=0');

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: 'limit must be a positive integer',
      });
    });

    it('tags local runs with source metadata', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request('/api/runs');

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        runs: Array<{
          filename: string;
          source: string;
          on_remote: boolean;
          final_state: { lifecycle: string; tags: string[] };
          tag_revision: string;
        }>;
      };
      expect(data.runs).toHaveLength(1);
      // A local-only run (no remote configured) is not on the remote branch.
      expect(data.runs[0]).toMatchObject({
        filename,
        source: 'local',
        on_remote: false,
        final_state: {
          lifecycle: 'active',
          tags: [],
        },
      });
      expect(data.runs[0].tag_revision).toStartWith('sha256:');
    });

    it('exposes sanitized Phoenix external_trace metadata through run detail only', async () => {
      const filename = '2026-03-25T10-15-00-000Z';
      createLocalRun(
        tempDir,
        filename,
        {
          ...RESULT_A,
          external_trace: {
            provider: 'phoenix',
            source: 'codex',
            endpoint: 'https://phoenix.example/v1/traces?api_key=artifact-secret',
            project: 'agentv-dogfood',
            session_id: 'codex-session-1',
            ui_url: 'https://phoenix.example/sessions/codex-session-1?token=artifact-secret',
          },
        },
        {
          ...RESULT_B,
          metadata: {
            external_trace: {
              provider: 'phoenix',
              endpoint: 'https://phoenix.example/v1/traces?api_key=artifact-secret',
              session_id: 'codex-session-2',
              ui_url: 'https://phoenix.example/sessions/codex-session-2?token=artifact-secret',
            },
          },
        },
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const detailRes = await app.request(`/api/runs/${encodeURIComponent(filename)}`);

      expect(detailRes.status).toBe(200);
      const detailData = (await detailRes.json()) as {
        results: Array<{
          testId: string;
          external_trace?: { endpoint?: string; ui_url?: string; session_id?: string };
        }>;
      };
      expect(detailData.results[0]).toMatchObject({
        testId: 'test-greeting',
        external_trace: {
          endpoint: 'https://phoenix.example/',
          ui_url: 'https://phoenix.example/sessions/codex-session-1',
          session_id: 'codex-session-1',
        },
      });
      expect(detailData.results[1]).toMatchObject({
        testId: 'test-math',
        external_trace: {
          endpoint: 'https://phoenix.example/',
          ui_url: 'https://phoenix.example/sessions/codex-session-2',
          session_id: 'codex-session-2',
        },
      });

      const serialized = JSON.stringify(detailData);
      expect(serialized).not.toContain('artifact-secret');
      expect(serialized).not.toContain('token=');
    });

    it('exposes materialized final state and tag revision for local run tags', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));
      const updatedAt = '2026-06-21T10:15:00.000Z';
      const tagRevision = createTagRevision(['accepted'], updatedAt);
      writeFileSync(
        path.join(runDir, 'tags.json'),
        `${JSON.stringify(
          {
            tags: ['accepted'],
            updated_at: updatedAt,
            tag_revision: tagRevision,
          },
          null,
          2,
        )}\n`,
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{
          tags: string[];
          final_state: { lifecycle: string; tags: string[] };
          tag_revision: string;
        }>;
      };
      expect(listData.runs[0]).toMatchObject({
        tags: ['accepted'],
        final_state: {
          lifecycle: 'active',
          tags: ['accepted'],
        },
        tag_revision: tagRevision,
      });

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(filename)}`);
      expect(detailRes.status).toBe(200);
      const detailData = (await detailRes.json()) as {
        tags: string[];
        final_state: { lifecycle: string; tags: string[] };
        tag_revision: string;
      };
      expect(detailData).toMatchObject({
        tags: ['accepted'],
        final_state: {
          lifecycle: 'active',
          tags: ['accepted'],
        },
        tag_revision: tagRevision,
      });
    });

    it('preserves a local tag clear state after DELETE /tags', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-30-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));
      const updatedAt = '2026-06-21T10:15:00.000Z';
      const tagRevision = createTagRevision(['accepted'], updatedAt);
      writeFileSync(
        path.join(runDir, 'tags.json'),
        `${JSON.stringify(
          {
            tags: ['accepted'],
            updated_at: updatedAt,
            tag_revision: tagRevision,
          },
          null,
          2,
        )}\n`,
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const deleteRes = await app.request(`/api/runs/${encodeURIComponent(filename)}/tags`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_tag_revision: tagRevision }),
      });
      expect(deleteRes.status).toBe(200);
      const deleteData = (await deleteRes.json()) as {
        ok: boolean;
        tags: string[];
        final_state: { lifecycle: string; tags: string[] };
        tag_revision: string;
        updated_at: string;
      };
      expect(deleteData.ok).toBe(true);
      expect(deleteData.tags).toEqual([]);
      expect(deleteData.final_state).toEqual({
        lifecycle: 'active',
        tags: [],
      });
      expect(deleteData.tag_revision).toStartWith('sha256:');
      expect(deleteData.tag_revision).not.toBe(tagRevision);

      const tagFile = JSON.parse(readFileSync(path.join(runDir, 'tags.json'), 'utf8')) as {
        tags: string[];
        tag_revision: string;
      };
      expect(tagFile.tags).toEqual([]);
      expect(tagFile.tag_revision).toBe(deleteData.tag_revision);

      const reloadedApp = createApp([], tempDir, tempDir, undefined, { studioDir });
      const detailRes = await reloadedApp.request(`/api/runs/${encodeURIComponent(filename)}`);
      expect(detailRes.status).toBe(200);
      const detailData = (await detailRes.json()) as {
        tags: string[];
        final_state: { lifecycle: string; tags: string[] };
        tag_revision: string;
      };
      expect(detailData).toMatchObject({
        tags: [],
        final_state: {
          lifecycle: 'active',
          tags: [],
        },
        tag_revision: deleteData.tag_revision,
      });
    });

    it('rejects stale local tag writes with refresh-required details', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-45-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));
      const updatedAt = '2026-06-21T10:15:00.000Z';
      const tagRevision = createTagRevision(['accepted'], updatedAt);
      writeFileSync(
        path.join(runDir, 'tags.json'),
        `${JSON.stringify(
          {
            tags: ['accepted'],
            updated_at: updatedAt,
            tag_revision: tagRevision,
          },
          null,
          2,
        )}\n`,
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const staleRes = await app.request(`/api/runs/${encodeURIComponent(filename)}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['stale'], expected_tag_revision: 'sha256:stale' }),
      });
      expect(staleRes.status).toBe(409);
      const staleData = (await staleRes.json()) as {
        error: string;
        expected_tag_revision: string;
        current_tag_revision: string;
      };
      expect(staleData).toEqual({
        error: 'Run tags changed. Refresh the run and try again.',
        expected_tag_revision: 'sha256:stale',
        current_tag_revision: tagRevision,
      });

      const tagFile = JSON.parse(readFileSync(path.join(runDir, 'tags.json'), 'utf8')) as {
        tags: string[];
        tag_revision: string;
      };
      expect(tagFile.tags).toEqual(['accepted']);
      expect(tagFile.tag_revision).toBe(tagRevision);
    });

    it('computes pass_rate using the configured dashboard threshold', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      const resultHigh = { ...RESULT_A, test_id: 'high', score: 0.8 };
      const resultLow = { ...RESULT_B, test_id: 'low', score: 0.6 };
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(resultHigh, resultLow));

      mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
      writeFileSync(path.join(tempDir, '.agentv', 'config.yaml'), 'dashboard:\n  threshold: 0.9\n');

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request('/api/runs');
      expect(res.status).toBe(200);
      const data = (await res.json()) as { runs: Array<{ pass_rate: number }> };
      expect(data.runs).toHaveLength(1);
      expect(data.runs[0].pass_rate).toBe(0);
    });

    it('reports execution errors separately from quality failures in run summaries', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      const qualityPass = { ...RESULT_A, category: 'runtime' };
      const qualityFail = { ...RESULT_B, category: 'runtime' };
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        toJsonl(qualityPass, qualityFail, RESULT_EXECUTION_ERROR),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const runRes = await app.request('/api/runs');
      expect(runRes.status).toBe(200);
      const runData = (await runRes.json()) as {
        runs: Array<{
          test_count: number;
          pass_rate: number;
          avg_score: number;
          execution_error_count?: number;
        }>;
      };
      expect(runData.runs).toHaveLength(1);
      expect(runData.runs[0].test_count).toBe(3);
      expect(runData.runs[0].execution_error_count).toBe(1);
      expect(runData.runs[0].pass_rate).toBe(0.5);
      expect(runData.runs[0].avg_score).toBe(0.75);

      const suitesRes = await app.request(`/api/runs/${filename}/suites`);
      expect(suitesRes.status).toBe(200);
      const suitesData = (await suitesRes.json()) as {
        suites: Array<{
          name: string;
          total: number;
          passed: number;
          failed: number;
          execution_error_count?: number;
        }>;
      };
      expect(suitesData.suites).toEqual([
        {
          name: 'demo',
          total: 3,
          passed: 1,
          failed: 1,
          avg_score: 0.75,
          execution_error_count: 1,
        },
      ]);

      const categoriesRes = await app.request(`/api/runs/${filename}/categories`);
      expect(categoriesRes.status).toBe(200);
      const categoriesData = (await categoriesRes.json()) as {
        categories: Array<{
          name: string;
          total: number;
          passed: number;
          failed: number;
          execution_error_count?: number;
          suite_count: number;
        }>;
      };
      expect(categoriesData.categories).toEqual([
        {
          name: 'runtime',
          total: 3,
          passed: 1,
          failed: 1,
          avg_score: 0.75,
          execution_error_count: 1,
          suite_count: 1,
        },
      ]);
    });

    it('infers the experiment name from the run id when live results have not written it yet', async () => {
      const runsDir = localResultsExperimentDir(tempDir, 'issue-1198-live-name');
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T12-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request('/api/runs');

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        runs: Array<{ experiment?: string; target?: string }>;
      };
      expect(data.runs).toHaveLength(1);
      expect(data.runs[0]).toMatchObject({
        experiment: 'issue-1198-live-name',
        target: 'gpt-4o',
      });
    });

    it('merges cached remote runs and tags them with remote source metadata', async () => {
      const previousHome = process.env.AGENTV_HOME;
      process.env.AGENTV_HOME = path.join(tempDir, 'agentv-home');

      try {
        writeLegacyShorthandResultsConfig(tempDir, 'EntityProcess/agentv-evals');

        const remoteRunDir = path.join(
          process.env.AGENTV_HOME,
          'results',
          'EntityProcess-agentv-evals',
          '.agentv',
          'results',
          'default',
          '2026-03-26T10-00-00-000Z',
        );
        mkdirSync(remoteRunDir, { recursive: true });
        writeFileSync(path.join(remoteRunDir, 'index.jsonl'), toJsonl(RESULT_A));

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/runs');

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          runs: Array<{ filename: string; source: string; on_remote: boolean }>;
        };
        expect(data.runs).toHaveLength(1);
        // A run only present on the remote branch (no local copy) reports
        // on_remote: true so it still shows with the on-remote indicator.
        expect(data.runs[0]).toMatchObject({
          filename: 'remote::2026-03-26T10-00-00-000Z',
          source: 'remote',
          on_remote: true,
        });
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    });

    it('lists and loads git-native remote runs from the configured clone path', async () => {
      const { remoteDir, cloneDir } = initializeRemoteRepo(tempDir);
      const runId = writeRemoteRunArtifact(
        cloneDir,
        'green-uat',
        '2026-03-26T10-00-00-000Z',
        RESULT_A,
      );

      writeResultsConfig(tempDir, { remote: `file://${remoteDir}`, path: cloneDir });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{
          filename: string;
          source: string;
          experiment?: string;
          pass_rate?: number;
          avg_score?: number;
        }>;
      };
      expect(listData.runs).toHaveLength(1);
      expect(listData.runs[0]).toMatchObject({
        filename: `remote::${runId}`,
        source: 'remote',
        experiment: 'green-uat',
        pass_rate: 1,
        avg_score: 1,
      });

      const detailRes = await app.request(
        `/api/runs/${encodeURIComponent(listData.runs[0].filename)}`,
      );
      expect(detailRes.status).toBe(200);
      const detailData = (await detailRes.json()) as {
        source: string;
        results: Array<{ test_id?: string; testId?: string }>;
      };
      expect(detailData.source).toBe('remote');
      expect(detailData.results).toHaveLength(1);
      expect(detailData.results[0]).toMatchObject({ testId: 'test-greeting' });
    }, 15000);

    it('lists git-native remote runs from the configured storage branch', async () => {
      const { remoteDir, cloneDir } = initializeRemoteRepo(tempDir);
      const storageBranch = 'agentv-results';
      git(`git switch --quiet --orphan ${storageBranch}`, cloneDir);
      git('git rm -rf --quiet . 2>/dev/null || true', cloneDir);
      git('git commit --quiet --allow-empty -m "seed results branch"', cloneDir);
      git(`git push --quiet origin HEAD:${storageBranch}`, cloneDir);
      const runId = writeRemoteRunArtifact(
        cloneDir,
        'branch-green-uat',
        '2026-03-26T11-00-00-000Z',
        RESULT_A,
        storageBranch,
      );

      writeResultsConfig(tempDir, {
        remote: `file://${remoteDir}`,
        branch: storageBranch,
        path: cloneDir,
      });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{ filename: string; source: string; experiment?: string }>;
      };
      expect(listData.runs).toHaveLength(1);
      expect(listData.runs[0]).toMatchObject({
        filename: `remote::${runId}`,
        source: 'remote',
        experiment: 'branch-green-uat',
      });
    }, 15000);

    it('auto-creates a missing storage branch without falling back to checked-out default branch runs', async () => {
      const { remoteDir, cloneDir } = initializeRemoteRepo(tempDir);
      const runId = writeRemoteRunArtifact(
        cloneDir,
        'main-only',
        '2026-03-26T11-30-00-000Z',
        RESULT_A,
      );

      writeResultsConfig(tempDir, {
        remote: `file://${remoteDir}`,
        branch: 'agentv-results',
        path: cloneDir,
      });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const statusRes = await app.request('/api/remote/status');
      expect(statusRes.status).toBe(200);
      const statusData = (await statusRes.json()) as {
        available: boolean;
        branch?: string;
        sync_status?: string;
        run_count: number;
        last_error?: string;
      };
      expect(statusData).toMatchObject({
        available: true,
        branch: 'agentv-results',
        sync_status: 'clean',
        run_count: 0,
      });
      expect(statusData.last_error).toBeUndefined();
      expect(git('git branch --show-current', cloneDir)).toBe('main');
      expect(
        git(
          'git show-ref --verify --quiet refs/remotes/agentv-results/agentv-results && echo present || true',
          cloneDir,
        ),
      ).toBe('');

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{ filename: string; source: string }>;
      };
      expect(listData.runs).toHaveLength(0);

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(`remote::${runId}`)}`);
      expect(detailRes.status).toBe(404);
    }, 15000);

    it('dedupes synced local and remote run copies in favor of the local run', async () => {
      const { remoteDir, cloneDir } = initializeRemoteRepo(tempDir);
      const runId = writeRemoteRunArtifact(
        cloneDir,
        'green-uat',
        '2026-03-26T10-30-00-000Z',
        RESULT_A,
      );
      writeLocalRunArtifact(tempDir, 'green-uat', '2026-03-26T10-30-00-000Z', RESULT_A);

      writeResultsConfig(tempDir, { remote: `file://${remoteDir}`, path: cloneDir });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{ filename: string; source: string; on_remote: boolean }>;
      };
      expect(listData.runs).toHaveLength(1);
      // A run present both locally and on the remote branch dedupes to a single
      // row that prefers the local copy but still reports on_remote: true — this
      // is the per-run flag the Dashboard's "on remote" indicator/count derive
      // from, so synced runs are no longer hidden.
      expect(listData.runs[0]).toMatchObject({
        filename: runId,
        source: 'local',
        on_remote: true,
      });
    }, 15000);

    it('edits synced local run tags through the remote metadata overlay', async () => {
      const { remoteDir, cloneDir } = initializeRemoteRepo(tempDir);
      const experiment = 'green-uat';
      const timestamp = '2026-03-26T10-45-00-000Z';
      const runId = writeRemoteRunArtifact(cloneDir, experiment, timestamp, RESULT_A);
      writeLocalRunArtifact(tempDir, experiment, timestamp, RESULT_A);

      writeResultsConfig(tempDir, { remote: `file://${remoteDir}`, path: cloneDir });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const putRes = await app.request(`/api/runs/${encodeURIComponent(runId)}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['needs-review'] }),
      });

      expect(putRes.status).toBe(200);
      const putData = (await putRes.json()) as {
        tags: string[];
        remote_tags: string[];
        pending_tags: string[];
        metadata_dirty: boolean;
      };
      expect(putData).toMatchObject({
        tags: ['needs-review'],
        remote_tags: [],
        pending_tags: ['needs-review'],
        metadata_dirty: true,
      });

      const localTagsPath = path.join(
        tempDir,
        '.agentv',
        'results',
        'runs',
        experiment,
        timestamp,
        'tags.json',
      );
      const overlayTagsPath = path.join(
        cloneDir,
        'metadata',
        'runs',
        experiment,
        timestamp,
        'tags.json',
      );
      expect(existsSync(localTagsPath)).toBe(false);
      expect(existsSync(overlayTagsPath)).toBe(true);

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{
          filename: string;
          source: string;
          on_remote: boolean;
          tags: string[];
          pending_tags: string[];
          metadata_dirty: boolean;
        }>;
      };
      expect(listData.runs[0]).toMatchObject({
        filename: runId,
        source: 'local',
        on_remote: true,
        tags: ['needs-review'],
        pending_tags: ['needs-review'],
        metadata_dirty: true,
      });
    }, 15000);

    it('computes git-native remote run list totals from materialized index rows', async () => {
      const { remoteDir, cloneDir } = initializeRemoteRepo(tempDir);
      const secondPass = {
        ...RESULT_A,
        test_id: 'test-tool-use',
        timestamp: '2026-03-18T10:00:02.000Z',
        score: 0.95,
      };
      const failingResult = {
        ...RESULT_B,
        timestamp: '2026-03-18T10:00:03.000Z',
        score: 0.4,
      };
      const runId = writeRemoteRunArtifact(cloneDir, 'green-uat', '2026-03-26T10-00-00-000Z', [
        RESULT_A,
        secondPass,
        failingResult,
      ]);

      writeResultsConfig(tempDir, { remote: `file://${remoteDir}`, path: cloneDir });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{
          filename: string;
          test_count: number;
          pass_rate: number;
          avg_score: number;
          experiment?: string;
          timestamp: string;
        }>;
      };
      expect(listData.runs).toHaveLength(1);
      expect(listData.runs[0].filename).toBe(`remote::${runId}`);
      expect(listData.runs[0].experiment).toBe('green-uat');
      expect(listData.runs[0].timestamp).toBe('2026-03-26T10:00:00.000Z');
      expect(listData.runs[0].test_count).toBe(3);
      expect(Math.round(listData.runs[0].pass_rate * listData.runs[0].test_count)).toBe(2);
      expect(listData.runs[0].pass_rate).toBeCloseTo(2 / 3, 5);
      expect(listData.runs[0].avg_score).toBeCloseTo((1 + 0.95 + 0.4) / 3, 5);

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(`remote::${runId}`)}`);
      expect(detailRes.status).toBe(200);
      const detailData = (await detailRes.json()) as { results: Array<{ testId: string }> };
      expect(detailData.results).toHaveLength(3);
    }, 15000);

    it('loads externally pushed remote runs after sync even when the clone has not checked out the files', async () => {
      const { remoteDir, cloneDir, seedDir } = initializeRemoteRepo(tempDir);
      const runId = writeRemoteRunArtifact(
        seedDir,
        'external-sync',
        '2026-03-26T11-00-00-000Z',
        RESULT_A,
      );

      writeResultsConfig(tempDir, { remote: `file://${remoteDir}`, path: cloneDir });

      const runManifestPath = path.join(
        cloneDir,
        'runs',
        'external-sync',
        '2026-03-26T11-00-00-000Z',
        'index.jsonl',
      );
      expect(existsSync(runManifestPath)).toBe(false);

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const syncRes = await app.request('/api/remote/sync', { method: 'POST' });
      expect(syncRes.status).toBe(200);
      const syncData = (await syncRes.json()) as { run_count: number };
      expect(syncData.run_count).toBe(1);

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{ filename: string; source: string }>;
      };
      expect(listData.runs).toHaveLength(1);
      expect(listData.runs[0]).toMatchObject({
        filename: `remote::${runId}`,
        source: 'remote',
      });

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(`remote::${runId}`)}`);
      expect(detailRes.status).toBe(200);
      expect(existsSync(runManifestPath)).toBe(true);
    }, 15000);

    it('edits remote run tags through metadata overlay and reloads effective tags', async () => {
      const { remoteDir, cloneDir } = initializeRemoteRepo(tempDir);
      const runId = writeRemoteRunArtifact(
        cloneDir,
        'green-uat',
        '2026-03-26T12-00-00-000Z',
        RESULT_A,
      );

      writeResultsConfig(tempDir, { remote: `file://${remoteDir}`, path: cloneDir });

      const filename = `remote::${runId}`;
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const putRes = await app.request(`/api/runs/${encodeURIComponent(filename)}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['pending-review', 'shared'] }),
      });

      expect(putRes.status).toBe(200);
      const putData = (await putRes.json()) as {
        tags: string[];
        remote_tags: string[];
        pending_tags: string[];
        metadata_dirty: boolean;
      };
      expect(putData).toMatchObject({
        tags: ['pending-review', 'shared'],
        remote_tags: [],
        pending_tags: ['pending-review', 'shared'],
        metadata_dirty: true,
      });

      const artifactTagsPath = path.join(
        cloneDir,
        'runs',
        'green-uat',
        '2026-03-26T12-00-00-000Z',
        'tags.json',
      );
      const overlayTagsPath = path.join(
        cloneDir,
        'metadata',
        'runs',
        'green-uat',
        '2026-03-26T12-00-00-000Z',
        'tags.json',
      );
      expect(existsSync(artifactTagsPath)).toBe(false);
      expect(existsSync(overlayTagsPath)).toBe(true);

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{
          filename: string;
          tags: string[];
          pending_tags: string[];
          metadata_dirty: boolean;
        }>;
      };
      expect(listData.runs[0]).toMatchObject({
        filename,
        tags: ['pending-review', 'shared'],
        pending_tags: ['pending-review', 'shared'],
        metadata_dirty: true,
      });

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(filename)}`);
      expect(detailRes.status).toBe(200);
      const detailData = (await detailRes.json()) as {
        tags: string[];
        pending_tags: string[];
        metadata_dirty: boolean;
      };
      expect(detailData).toMatchObject({
        tags: ['pending-review', 'shared'],
        pending_tags: ['pending-review', 'shared'],
        metadata_dirty: true,
      });

      const reloadedApp = createApp([], tempDir, tempDir, undefined, { studioDir });
      const reloadedRes = await reloadedApp.request('/api/runs');
      expect(reloadedRes.status).toBe(200);
      const reloadedData = (await reloadedRes.json()) as {
        runs: Array<{ tags: string[]; pending_tags: string[]; metadata_dirty: boolean }>;
      };
      expect(reloadedData.runs[0]).toMatchObject({
        tags: ['pending-review', 'shared'],
        pending_tags: ['pending-review', 'shared'],
        metadata_dirty: true,
      });
    }, 15000);

    it('rejects remote tag edits when the configured results path is not writable', async () => {
      const plainResultsDir = path.join(tempDir, 'plain-results');
      const timestamp = '2026-03-26T13-00-00-000Z';
      const runDir = localRunDir(plainResultsDir, 'default', timestamp);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));

      writeResultsConfig(tempDir, {
        remote: `file://${path.join(tempDir, 'missing.git')}`,
        path: plainResultsDir,
      });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(`remote::${timestamp}`)}/tags`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: ['blocked'] }),
        },
      );

      expect(res.status).toBe(409);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain('not a writable git checkout');
      expect(existsSync(path.join(runDir, 'tags.json'))).toBe(false);
    });

    it('loads a local run detail without cloning or fetching the configured results repo', async () => {
      const remoteDir = path.join(tempDir, 'results-remote.git');
      git(`git init --bare --initial-branch=main --quiet "${remoteDir}"`, tempDir);
      const missingCloneDir = path.join(tempDir, 'missing-results-clone');
      const runId = writeLocalRunArtifact(
        tempDir,
        'local-detail',
        '2026-03-26T14-00-00-000Z',
        RESULT_A,
      );

      writeResultsConfig(tempDir, { remote: `file://${remoteDir}`, path: missingCloneDir });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const detailRes = await app.request(`/api/runs/${encodeURIComponent(runId)}`);

      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as { source: string; results: unknown[] };
      expect(detail.source).toBe('local');
      expect(detail.results).toHaveLength(1);
      expect(existsSync(missingCloneDir)).toBe(false);
    });

    it('does not expose an unscoped selected-run publish endpoint', async () => {
      const remoteDir = path.join(tempDir, 'results-remote.git');
      git(`git init --bare --initial-branch=main --quiet "${remoteDir}"`, tempDir);
      const missingCloneDir = path.join(tempDir, 'missing-results-clone');
      const runId = writeLocalRunArtifact(
        tempDir,
        'no-publish-route',
        '2026-03-26T15-00-00-000Z',
        RESULT_A,
      );

      writeResultsConfig(tempDir, { remote: `file://${remoteDir}`, path: missingCloneDir });

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const previewRes = await app.request(`/api/runs/${encodeURIComponent(runId)}/publish`);
      const publishRes = await app.request(`/api/runs/${encodeURIComponent(runId)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace: true }),
      });

      expect(previewRes.status).toBe(404);
      expect(publishRes.status).toBe(404);
      expect(existsSync(missingCloneDir)).toBe(false);
    });

    it('does not expose a project-scoped selected-run publish endpoint', async () => {
      const previousHome = process.env.AGENTV_HOME;
      const homeDir = path.join(tempDir, 'agentv-home-no-publish');
      process.env.AGENTV_HOME = homeDir;

      try {
        const remoteDir = path.join(tempDir, 'results-remote.git');
        git(`git init --bare --initial-branch=main --quiet "${remoteDir}"`, tempDir);
        const missingCloneDir = path.join(tempDir, 'missing-project-results-clone');
        const projectDir = path.join(tempDir, 'source-project-no-publish');
        const runId = writeLocalRunArtifact(
          projectDir,
          'project-no-publish-route',
          '2026-03-26T16-00-00-000Z',
          RESULT_A,
        );
        mkdirSync(homeDir, { recursive: true });
        saveProjectRegistry({
          projects: [
            {
              id: 'project-no-publish',
              name: 'Project No Publish',
              path: projectDir,
              results: {
                repoUrl: `file://${remoteDir}`,
                path: missingCloneDir,
                sync: { autoPush: true },
              },
              addedAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const previewRes = await app.request(
          `/api/projects/project-no-publish/runs/${encodeURIComponent(runId)}/publish`,
        );
        const publishRes = await app.request(
          `/api/projects/project-no-publish/runs/${encodeURIComponent(runId)}/publish`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ replace: true }),
          },
        );

        expect(previewRes.status).toBe(404);
        expect(publishRes.status).toBe(404);
        expect(existsSync(missingCloneDir)).toBe(false);
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    });
  });

  describe('GET /api/projects/all-runs', () => {
    it('infers experiment names for live benchmark runs before records persist them', async () => {
      const homedirSpy = spyOn(os, 'homedir').mockReturnValue(path.join(tempDir, 'home'));

      try {
        const benchmarkDir = path.join(tempDir, 'bench-one');
        const runDir = localRunDir(
          benchmarkDir,
          'issue-1198-benchmark',
          '2026-03-25T12-00-00-000Z',
        );
        mkdirSync(runDir, { recursive: true });
        writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));
        const project = addProject(benchmarkDir);

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/projects/all-runs');

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          runs: Array<{ project_id: string; experiment?: string; target?: string }>;
        };
        expect(data.runs).toHaveLength(1);
        expect(data.runs[0]).toMatchObject({
          project_id: project.id,
          experiment: 'issue-1198-benchmark',
          target: 'gpt-4o',
        });
      } finally {
        homedirSpy.mockRestore();
      }
    });
  });

  describe('GET /api/remote/status', () => {
    it('reports configured remote status with graceful local-only fallback', async () => {
      const previousHome = process.env.AGENTV_HOME;
      process.env.AGENTV_HOME = path.join(tempDir, 'agentv-home-status');

      try {
        writeLegacyShorthandResultsConfig(tempDir, 'EntityProcess/agentv-evals');

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/remote/status');

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          configured: boolean;
          available: boolean;
          repo: string;
          path: string;
        };
        expect(data.configured).toBe(true);
        expect(data.available).toBe(false);
        expect(data.repo).toBe('EntityProcess/agentv-evals');
        expect(data.path).toBe(
          path.join(tempDir, 'agentv-home-status', 'results', 'EntityProcess-agentv-evals'),
        );
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    });

    it('uses registered project results for project-scoped remote status', async () => {
      const previousHome = process.env.AGENTV_HOME;
      const homeDir = path.join(tempDir, 'agentv-home-project-status');
      process.env.AGENTV_HOME = homeDir;

      try {
        const projectDir = path.join(tempDir, 'source-project');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        mkdirSync(homeDir, { recursive: true });
        writeFileSync(
          path.join(projectDir, '.agentv', 'config.yaml'),
          'execution:\n  verbose: true\n',
        );
        writeLegacyGlobalShorthandResultsConfig(homeDir, 'EntityProcess/fallback-results');
        saveProjectRegistry({
          projects: [
            {
              id: 'agentv',
              name: 'AgentV',
              path: projectDir,
              results: {
                repoUrl: 'EntityProcess/agentv-examples-eval-results',
                path: '/home/entity/projects/EntityProcess/agentv-examples-eval-results',
                sync: { autoPush: true },
              },
              addedAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/projects/agentv/remote/status');

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          configured: boolean;
          repo: string;
          path: string;
          auto_push: boolean;
        };
        expect(data.configured).toBe(true);
        expect(data.repo).toBe('EntityProcess/agentv-examples-eval-results');
        expect(data.path).toBe('/home/entity/projects/EntityProcess/agentv-examples-eval-results');
        expect(data.auto_push).toBe(true);
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    });
  });

  describe('POST /api/projects/:projectId/remote/sync', () => {
    it('fast-forwards a clean behind results repo through project sync', async () => {
      const previousHome = process.env.AGENTV_HOME;
      const homeDir = path.join(tempDir, 'agentv-home-project-sync-pull');
      process.env.AGENTV_HOME = homeDir;

      try {
        const { remoteDir, cloneDir, seedDir } = initializeRemoteRepo(tempDir);
        const projectDir = path.join(tempDir, 'source-project-sync-pull');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        mkdirSync(homeDir, { recursive: true });
        saveProjectRegistry({
          projects: [
            {
              id: 'project-sync-pull',
              name: 'Project Sync Pull',
              path: projectDir,
              results: {
                repoUrl: `file://${remoteDir}`,
                path: cloneDir,
                sync: { autoPush: false },
              },
              addedAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
        const runId = writeDirtyRemoteRunArtifact(
          seedDir,
          'project-sync-pull',
          '2026-03-26T11-00-00-000Z',
          RESULT_A,
        );
        git('git add runs && git commit --quiet -m "remote result"', seedDir);
        git('git push --quiet origin main', seedDir);

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/projects/project-sync-pull/remote/sync', {
          method: 'POST',
        });

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          sync_status: string;
          commit_created?: boolean;
          push_performed?: boolean;
          pull_performed?: boolean;
          blocked?: boolean;
          run_count: number;
        };
        expect(data).toMatchObject({
          sync_status: 'clean',
          commit_created: false,
          push_performed: false,
          pull_performed: true,
          blocked: false,
          run_count: 1,
        });
        expect(
          existsSync(
            path.join(
              cloneDir,
              'runs',
              'project-sync-pull',
              runId.replace('project-sync-pull::', ''),
              'index.jsonl',
            ),
          ),
        ).toBe(true);
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    }, 15000);

    it('commits and pushes dirty remote tag metadata through project sync', async () => {
      const previousHome = process.env.AGENTV_HOME;
      const homeDir = path.join(tempDir, 'agentv-home-project-sync-push');
      process.env.AGENTV_HOME = homeDir;

      try {
        const { remoteDir, cloneDir } = initializeRemoteRepo(tempDir);
        const projectDir = path.join(tempDir, 'source-project-sync-push');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        mkdirSync(homeDir, { recursive: true });
        saveProjectRegistry({
          projects: [
            {
              id: 'project-sync-push',
              name: 'Project Sync Push',
              path: projectDir,
              results: {
                repoUrl: `file://${remoteDir}`,
                path: cloneDir,
                sync: { autoPush: true },
              },
              addedAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
        const runTimestamp = '2026-03-26T12-00-00-000Z';
        writeRemoteRunArtifact(cloneDir, 'project-sync-push', runTimestamp, RESULT_A);
        writeRemoteTagMetadataOverlay(cloneDir, 'project-sync-push', runTimestamp, [
          'pending-review',
          'shared',
        ]);

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/projects/project-sync-push/remote/sync', {
          method: 'POST',
        });

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          sync_status: string;
          commit_created?: boolean;
          push_performed?: boolean;
          pull_performed?: boolean;
          blocked?: boolean;
          run_count: number;
        };
        expect(data).toMatchObject({
          sync_status: 'clean',
          commit_created: true,
          push_performed: true,
          pull_performed: false,
          blocked: false,
          run_count: 1,
        });
        expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, tempDir)).toContain(
          `metadata/runs/project-sync-push/${runTimestamp}/tags.json`,
        );
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    }, 15000);

    it('keeps cached remote run count when project sync cannot fetch the remote', async () => {
      const previousHome = process.env.AGENTV_HOME;
      const homeDir = path.join(tempDir, 'agentv-home-project-sync-offline');
      process.env.AGENTV_HOME = homeDir;

      try {
        const { cloneDir } = initializeRemoteRepo(tempDir);
        const missingRemoteUrl = `file://${path.join(tempDir, 'missing-results-remote.git')}`;
        const projectDir = path.join(tempDir, 'source-project-sync-offline');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        mkdirSync(homeDir, { recursive: true });
        saveProjectRegistry({
          projects: [
            {
              id: 'project-sync-offline',
              name: 'Project Sync Offline',
              path: projectDir,
              results: {
                repoUrl: missingRemoteUrl,
                path: cloneDir,
                sync: { autoPush: true },
              },
              addedAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
        writeRemoteRunArtifact(
          cloneDir,
          'project-sync-offline',
          '2026-03-26T12-30-00-000Z',
          RESULT_A,
        );
        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/projects/project-sync-offline/remote/sync', {
          method: 'POST',
        });

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          available?: boolean;
          blocked?: boolean;
          block_reason?: string;
          run_count?: number;
        };
        expect(data.available).toBe(true);
        expect(data.blocked).toBe(true);
        expect(data.block_reason).toContain('does not appear to be a git repository');
        expect(data.run_count).toBe(1);
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    }, 15000);

    it('returns a blocked conflict state without resetting the results repo', async () => {
      const previousHome = process.env.AGENTV_HOME;
      const homeDir = path.join(tempDir, 'agentv-home-project-sync-conflict');
      process.env.AGENTV_HOME = homeDir;

      try {
        const { remoteDir, cloneDir, seedDir } = initializeRemoteRepo(tempDir);
        const projectDir = path.join(tempDir, 'source-project-sync-conflict');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        mkdirSync(homeDir, { recursive: true });
        saveProjectRegistry({
          projects: [
            {
              id: 'project-sync-conflict',
              name: 'Project Sync Conflict',
              path: projectDir,
              results: {
                repoUrl: `file://${remoteDir}`,
                path: cloneDir,
                sync: { autoPush: true },
              },
              addedAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });

        const runTimestamp = '2026-03-26T13-00-00-000Z';
        const relativeMetadataPath = path.posix.join(
          'metadata',
          'runs',
          'project-sync-conflict',
          runTimestamp,
          'tags.json',
        );
        writeRemoteTagMetadataOverlay(seedDir, 'project-sync-conflict', runTimestamp, ['base']);
        git('git add metadata && git commit --quiet -m "seed tag metadata"', seedDir);
        git('git push --quiet origin main', seedDir);
        git('git pull --ff-only --quiet', cloneDir);

        writeRemoteTagMetadataOverlay(cloneDir, 'project-sync-conflict', runTimestamp, ['local']);
        git('git add metadata && git commit --quiet -m "local tag metadata"', cloneDir);
        writeRemoteTagMetadataOverlay(seedDir, 'project-sync-conflict', runTimestamp, ['remote']);
        git('git add metadata && git commit --quiet -m "remote tag metadata"', seedDir);
        git('git push --quiet origin main', seedDir);
        git('git fetch --quiet origin --prune', cloneDir);
        git('git merge origin/main || true', cloneDir);

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/projects/project-sync-conflict/remote/sync', {
          method: 'POST',
        });

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          sync_status: string;
          blocked?: boolean;
          block_reason?: string;
          pull_performed?: boolean;
          push_performed?: boolean;
          commit_created?: boolean;
          conflicted_paths?: string[];
          git_status?: string;
        };
        expect(data).toMatchObject({
          sync_status: 'conflicted',
          blocked: true,
          pull_performed: false,
          push_performed: false,
          commit_created: false,
        });
        expect(data.block_reason).toContain('unresolved git conflicts');
        expect(data.conflicted_paths).toContain(relativeMetadataPath);
        expect(data.git_status).toContain('UU');
        expect(readFileSync(path.join(cloneDir, relativeMetadataPath), 'utf8')).toContain(
          '<<<<<<< HEAD',
        );
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    }, 20000);
  });

  // ── GET /api/runs/:filename ─────────────────────────────────────────

  describe('GET /api/runs/:filename', () => {
    it('returns 404 for nonexistent run', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/runs/nonexistent');
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe('Run not found');
    });

    it('loads results from an existing run file', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A, RESULT_B));

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(`/api/runs/${filename}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        results: { testId: string }[];
        source: 'local' | 'remote';
        source_label: string;
      };
      expect(data.results).toHaveLength(2);
      expect(data.results[0].testId).toBe('test-greeting');
      expect(data.source).toBe('local');
      expect(data.source_label).toBe(filename);
    });

    it('loads historical runs without task bundle metadata', async () => {
      const runId = writeLocalRunArtifact(
        tempDir,
        'historical',
        '2026-03-25T12-00-00-000Z',
        RESULT_A,
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(`/api/runs/${encodeURIComponent(runId)}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        results: Array<Record<string, unknown>>;
      };
      expect(data.results[0]).not.toHaveProperty('task_dir');
      expect(data.results[0]).not.toHaveProperty('source_traceability');
    });
  });

  describe('run combine API', () => {
    function seedRun(
      name: string,
      records: object[] = [RESULT_A],
      opts?: { experiment?: string; tags?: string[]; baseDir?: string },
    ): { runId: string; runDir: string; manifestPath: string } {
      const runDir = localRunDir(opts?.baseDir ?? tempDir, opts?.experiment ?? 'default', name);
      mkdirSync(runDir, { recursive: true });
      const manifestPath = path.join(runDir, 'index.jsonl');
      writeFileSync(manifestPath, toJsonl(...records));
      if (opts?.tags) {
        writeFileSync(
          path.join(runDir, 'tags.json'),
          `${JSON.stringify({ tags: opts.tags, updated_at: '2026-04-10T00:00:00.000Z' }, null, 2)}\n`,
        );
      }
      return {
        runId: opts?.experiment ? `${opts.experiment}::${name}` : name,
        runDir,
        manifestPath,
      };
    }

    it('combines two local finished runs into a new run workspace with unioned tags', async () => {
      const first = seedRun('2026-06-01T10-00-00-000Z', [RESULT_A], {
        tags: ['baseline', 'shared'],
      });
      const second = seedRun('2026-06-01T11-00-00-000Z', [RESULT_B], {
        tags: ['shared', 'candidate'],
      });
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const res = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_ids: [first.runId, second.runId],
          display_name: 'Combined Smoke',
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as {
        run_id: string;
        display_name: string;
        experiment: string;
        combined_from_run_ids: string[];
      };
      expect(data.display_name).toBe('Combined Smoke');
      expect(data.experiment).toBe('default');
      expect(data.run_id).toBe('2026-03-18T10-00-01-000Z');
      expect(data.combined_from_run_ids).toEqual([first.runId, second.runId]);

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(data.run_id)}`);
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as { results: Array<{ testId: string }> };
      expect(detail.results.map((r) => r.testId).sort()).toEqual(['test-greeting', 'test-math']);

      const combinedDir = localRunDirFromRunId(tempDir, data.run_id);
      const tags = JSON.parse(readFileSync(path.join(combinedDir, 'tags.json'), 'utf8')) as {
        tags: string[];
      };
      expect(tags.tags.sort()).toEqual(['baseline', 'candidate', 'shared']);
      const benchmark = JSON.parse(
        readFileSync(path.join(combinedDir, 'benchmark.json'), 'utf8'),
      ) as {
        metadata: { combined_from_run_ids?: string[]; display_name?: string; timestamp?: string };
      };
      expect(benchmark.metadata.combined_from_run_ids).toEqual([first.runId, second.runId]);
      expect(benchmark.metadata.display_name).toBe('Combined Smoke');
      expect(benchmark.metadata).toMatchObject({ experiment: 'default' });
      expect(benchmark.metadata.timestamp).toBe('2026-03-18T10:00:01.000Z');
    });

    it('requires an explicit experiment when combining runs across experiments', async () => {
      const first = seedRun('2026-06-01T10-00-00-000Z', [RESULT_A], {
        experiment: 'smoke',
      });
      const second = seedRun('2026-06-01T11-00-00-000Z', [RESULT_B], {
        experiment: 'regression',
      });
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const rejected = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_ids: [first.runId, second.runId] }),
      });
      expect(rejected.status).toBe(400);
      const rejectedData = (await rejected.json()) as { error: string };
      expect(rejectedData.error).toContain(
        'Combining runs from multiple experiments requires an experiment name',
      );

      const accepted = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_ids: [first.runId, second.runId],
          experiment: 'smoke-regression',
        }),
      });
      expect(accepted.status).toBe(201);
      const acceptedData = (await accepted.json()) as { run_id: string; experiment: string };
      expect(acceptedData.experiment).toBe('smoke-regression');
      expect(acceptedData.run_id).toStartWith('smoke-regression::');
      expect(existsSync(localRunDirFromRunId(tempDir, acceptedData.run_id))).toBe(true);

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(acceptedData.run_id)}`);
      expect(detailRes.status).toBe(200);
      await detailRes.json();
      const records = readFileSync(
        path.join(localRunDirFromRunId(tempDir, acceptedData.run_id), 'index.jsonl'),
        'utf8',
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { experiment?: string });
      expect(records.map((result) => result.experiment)).toEqual([
        'smoke-regression',
        'smoke-regression',
      ]);
    });

    it('generates a display name when combine omits display_name', async () => {
      const first = seedRun('2026-06-01T10-00-00-000Z', [RESULT_A]);
      const second = seedRun('2026-06-01T11-00-00-000Z', [RESULT_B]);
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const res = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_ids: [first.runId, second.runId] }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as { display_name: string };
      expect(data.display_name).toContain('Combined run');
    });

    it('rejects invalid combine payloads', async () => {
      const first = seedRun('2026-06-01T10-00-00-000Z', [RESULT_A]);
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const tooFew = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_ids: [first.runId] }),
      });
      expect(tooFew.status).toBe(400);

      const duplicate = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_ids: [first.runId, first.runId] }),
      });
      expect(duplicate.status).toBe(400);

      const missing = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_ids: [first.runId, 'missing-run'] }),
      });
      expect(missing.status).toBe(404);

      const invalidJson = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });
      expect(invalidJson.status).toBe(400);

      const invalidPolicy = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_ids: [first.runId, 'missing-run'],
          duplicate_policy: 'prompt',
        }),
      });
      expect(invalidPolicy.status).toBe(400);

      const invalidExperiment = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_ids: [first.runId, 'missing-run'],
          experiment: 123,
        }),
      });
      expect(invalidExperiment.status).toBe(400);
    });

    it('rejects duplicate rows by default and combines with explicit latest policy', async () => {
      const older = {
        ...RESULT_A,
        timestamp: '2026-06-01T10:00:00.000Z',
        score: 0.1,
      };
      const newer = {
        ...RESULT_A,
        timestamp: '2026-06-01T11:00:00.000Z',
        score: 0.9,
      };
      const first = seedRun('2026-06-01T10-00-00-000Z', [older]);
      const second = seedRun('2026-06-01T11-00-00-000Z', [newer]);
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const rejected = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_ids: [first.runId, second.runId] }),
      });
      expect(rejected.status).toBe(409);
      const rejectedData = (await rejected.json()) as {
        duplicates: Array<{ test_id: string; target: string; latest_source_id: string }>;
      };
      expect(rejectedData.duplicates).toHaveLength(1);
      expect(rejectedData.duplicates[0]).toMatchObject({
        test_id: 'test-greeting',
        target: 'gpt-4o',
        latest_source_id: second.runId,
      });

      const accepted = await app.request('/api/runs/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_ids: [first.runId, second.runId],
          duplicate_policy: 'latest',
        }),
      });
      expect(accepted.status).toBe(201);
      const data = (await accepted.json()) as { run_id: string; duplicate_conflicts: unknown[] };
      expect(data.duplicate_conflicts).toHaveLength(1);
      const detailRes = await app.request(`/api/runs/${encodeURIComponent(data.run_id)}`);
      const detail = (await detailRes.json()) as {
        results: Array<{ testId: string; score: number }>;
      };
      expect(detail.results).toHaveLength(1);
      expect(detail.results[0]).toMatchObject({ testId: 'test-greeting', score: 0.9 });
    });

    it('rejects combining remote runs', async () => {
      const previousHome = process.env.AGENTV_HOME;
      process.env.AGENTV_HOME = path.join(tempDir, 'agentv-home');
      try {
        const local = seedRun('2026-06-01T10-00-00-000Z', [RESULT_A]);
        writeLegacyShorthandResultsConfig(tempDir, 'EntityProcess/agentv-evals');
        const remoteRunDir = path.join(
          process.env.AGENTV_HOME,
          'results',
          'EntityProcess-agentv-evals',
          '.agentv',
          'results',
          'default',
          '2026-06-01T11-00-00-000Z',
        );
        mkdirSync(remoteRunDir, { recursive: true });
        writeFileSync(path.join(remoteRunDir, 'index.jsonl'), toJsonl(RESULT_B));
        const app = createApp([], tempDir, tempDir, undefined, { studioDir });

        const res = await app.request('/api/runs/combine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            run_ids: [local.runId, 'remote::2026-06-01T11-00-00-000Z'],
          }),
        });

        expect(res.status).toBe(400);
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    });

    it('supports project-scoped combine within the selected project', async () => {
      const homedirSpy = spyOn(os, 'homedir').mockReturnValue(path.join(tempDir, 'home'));
      try {
        const projectDir = path.join(tempDir, 'project-one');
        const otherProjectDir = path.join(tempDir, 'project-two');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        mkdirSync(path.join(otherProjectDir, '.agentv'), { recursive: true });
        const project = addProject(projectDir);
        addProject(otherProjectDir);

        const first = seedRun('2026-06-01T10-00-00-000Z', [RESULT_A], { baseDir: projectDir });
        const secondRunDir = localRunDir(projectDir, 'default', '2026-06-01T11-00-00-000Z');
        mkdirSync(secondRunDir, { recursive: true });
        writeFileSync(path.join(secondRunDir, 'index.jsonl'), toJsonl(RESULT_B));
        const otherRunDir = localRunDir(otherProjectDir, 'default', '2026-06-01T10-00-00-000Z');
        mkdirSync(otherRunDir, { recursive: true });
        writeFileSync(path.join(otherRunDir, 'index.jsonl'), toJsonl(RESULT_A));

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const combine = await app.request(`/api/projects/${project.id}/runs/combine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            run_ids: [first.runId, '2026-06-01T11-00-00-000Z'],
          }),
        });
        expect(combine.status).toBe(201);
        expect(existsSync(otherRunDir)).toBe(true);
        expect(existsSync(localRunDirFromRunId(projectDir, first.runId))).toBe(true);
      } finally {
        homedirSpy.mockRestore();
      }
    });
  });

  describe('run delete API', () => {
    function seedRun(
      name: string,
      records: object[] = [RESULT_A],
      opts?: { experiment?: string; baseDir?: string },
    ): { runId: string; runDir: string } {
      const runDir = localRunDir(opts?.baseDir ?? tempDir, opts?.experiment ?? 'default', name);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(...records));
      writeFileSync(path.join(runDir, 'tags.json'), '{"tags":["stale"]}\n');
      return {
        runId: opts?.experiment ? `${opts.experiment}::${name}` : name,
        runDir,
      };
    }

    it('deletes a local run workspace and rejects missing runs', async () => {
      const run = seedRun('2026-06-01T10-00-00-000Z');
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const deleted = await app.request(`/api/runs/${encodeURIComponent(run.runId)}`, {
        method: 'DELETE',
      });
      expect(deleted.status).toBe(200);
      expect(existsSync(run.runDir)).toBe(false);

      const missing = await app.request(`/api/runs/${encodeURIComponent(run.runId)}`, {
        method: 'DELETE',
      });
      expect(missing.status).toBe(404);
    });

    it('rejects deleting remote runs', async () => {
      const previousHome = process.env.AGENTV_HOME;
      process.env.AGENTV_HOME = path.join(tempDir, 'agentv-home');
      try {
        writeLegacyShorthandResultsConfig(tempDir, 'EntityProcess/agentv-evals');
        const remoteRunDir = path.join(
          process.env.AGENTV_HOME,
          'results',
          'EntityProcess-agentv-evals',
          '.agentv',
          'results',
          'default',
          '2026-06-01T11-00-00-000Z',
        );
        mkdirSync(remoteRunDir, { recursive: true });
        writeFileSync(path.join(remoteRunDir, 'index.jsonl'), toJsonl(RESULT_B));
        const app = createApp([], tempDir, tempDir, undefined, { studioDir });

        const res = await app.request(
          `/api/runs/${encodeURIComponent('remote::2026-06-01T11-00-00-000Z')}`,
          { method: 'DELETE' },
        );

        expect(res.status).toBe(400);
        expect(existsSync(remoteRunDir)).toBe(true);
      } finally {
        if (previousHome === undefined) {
          process.env.AGENTV_HOME = undefined;
        } else {
          process.env.AGENTV_HOME = previousHome;
        }
      }
    });

    it('supports project-scoped run deletion within the selected project', async () => {
      const homedirSpy = spyOn(os, 'homedir').mockReturnValue(path.join(tempDir, 'home'));
      try {
        const projectDir = path.join(tempDir, 'project-one');
        const otherProjectDir = path.join(tempDir, 'project-two');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        mkdirSync(path.join(otherProjectDir, '.agentv'), { recursive: true });
        const project = addProject(projectDir);
        addProject(otherProjectDir);

        const run = seedRun('2026-06-01T10-00-00-000Z', [RESULT_A], { baseDir: projectDir });
        const otherRun = seedRun('2026-06-01T10-00-00-000Z', [RESULT_B], {
          baseDir: otherProjectDir,
        });
        const app = createApp([], tempDir, tempDir, undefined, { studioDir });

        const deleted = await app.request(
          `/api/projects/${project.id}/runs/${encodeURIComponent(run.runId)}`,
          { method: 'DELETE' },
        );

        expect(deleted.status).toBe(200);
        expect(existsSync(run.runDir)).toBe(false);
        expect(existsSync(otherRun.runDir)).toBe(true);
      } finally {
        homedirSpy.mockRestore();
      }
    });
  });

  describe('GET /api/runs/:filename/evals/:evalId/trace-session', () => {
    function writeLocalTraceRun(
      projectDir: string,
      experiment: string,
      timestamp: string,
      traceArtifactPath: string,
      traceContent: string,
      recordOverrides?: Record<string, unknown>,
    ): string {
      const runId = `${experiment}::${timestamp}`;
      const runDir = localRunDir(projectDir, experiment, timestamp);
      const tracePath = path.join(runDir, traceArtifactPath);
      mkdirSync(path.dirname(tracePath), { recursive: true });
      writeFileSync(tracePath, traceContent);
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment,
          trace_path: traceArtifactPath,
          ...recordOverrides,
        }),
      );
      return runId;
    }

    it('projects a local AgentV trace sidecar through the Dashboard read model', async () => {
      const traceArtifactPath = 'demo/test-greeting/trace.json';
      const runId = 'with-trace::2026-03-25T09-00-00-000Z';
      writeLocalTraceRun(
        tempDir,
        'with-trace',
        '2026-03-25T09-00-00-000Z',
        traceArtifactPath,
        `${JSON.stringify(traceSessionEnvelope({ runId, spanName: 'local root' }))}\n`,
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/trace-session`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        schema_version: string;
        status: string;
        trace_path: string;
        trace_session: {
          schema_version: string;
          run_id?: string;
          test_id?: string;
          spans: Array<{ name: string; token_usage?: { input?: number } }>;
          events: Array<{ kind: string; score?: number }>;
        };
      };
      expect(data.schema_version).toBe('agentv.dashboard.trace_artifact.v1');
      expect(data.status).toBe('ok');
      expect(data.trace_path).toBe(traceArtifactPath);
      expect(data.trace_session).toMatchObject({
        schema_version: 'agentv.dashboard.trace_session.v1',
        run_id: runId,
        test_id: 'test-greeting',
      });
      expect(data.trace_session.spans[0]).toMatchObject({
        name: 'local root',
        token_usage: { input: 7 },
      });
      expect(data.trace_session.events[0]).toMatchObject({ kind: 'score', score: 1 });
    });

    it('returns equivalent payloads for unscoped and project-scoped routes', async () => {
      const homedirSpy = spyOn(os, 'homedir').mockReturnValue(path.join(tempDir, 'home'));
      try {
        const projectDir = path.join(tempDir, 'project-one');
        mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
        const project = addProject(projectDir);
        const traceArtifactPath = 'demo/test-greeting/trace.json';
        const runId = writeLocalTraceRun(
          projectDir,
          'project-trace',
          '2026-03-25T09-30-00-000Z',
          traceArtifactPath,
          `${JSON.stringify(traceSessionEnvelope({ spanName: 'project root' }))}\n`,
        );

        const app = createApp([], projectDir, projectDir, undefined, { studioDir });
        const unscoped = await app.request(
          `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/trace-session`,
        );
        const scoped = await app.request(
          `/api/projects/${project.id}/runs/${encodeURIComponent(runId)}/evals/test-greeting/trace-session`,
        );

        expect(unscoped.status).toBe(200);
        expect(scoped.status).toBe(200);
        expect(await scoped.json()).toEqual(await unscoped.json());
      } finally {
        homedirSpy.mockRestore();
      }
    });

    it('returns a typed missing state without breaking run detail', async () => {
      const runId = writeLocalRunArtifact(
        tempDir,
        'missing-trace',
        '2026-03-25T10-30-00-000Z',
        RESULT_A,
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const traceRes = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/trace-session`,
      );
      expect(traceRes.status).toBe(200);
      const traceData = (await traceRes.json()) as {
        schema_version: string;
        status: string;
        message: string;
      };
      expect(traceData.schema_version).toBe('agentv.dashboard.trace_artifact.v1');
      expect(traceData.status).toBe('missing');
      expect(traceData.message).toContain('trace.json');

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(runId)}`);
      expect(detailRes.status).toBe(200);
      const detailData = (await detailRes.json()) as { results: Array<{ testId: string }> };
      expect(detailData.results[0]?.testId).toBe('test-greeting');
    });

    it('returns a typed dangling state when the trace pointer cannot be read', async () => {
      const runsDir = localResultsExperimentDir(tempDir, 'dangling-trace');
      const runId = 'dangling-trace::2026-03-25T10-45-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T10-45-00-000Z');
      const artifactPath = 'demo/test-greeting/trace.json';

      mkdirSync(timestampDir, { recursive: true });
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'dangling-trace',
          trace_path: artifactPath,
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/trace-session`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        status: string;
        trace_path: string;
        message: string;
      };
      expect(data.status).toBe('dangling');
      expect(data.trace_path).toBe(artifactPath);
      expect(data.message).toContain('not available');
    });

    it('normalizes supported OTLP trace artifacts instead of returning unsupported', async () => {
      const traceArtifactPath = 'demo/test-greeting/trace.json';
      const runId = writeLocalTraceRun(
        tempDir,
        'otlp-trace',
        '2026-03-25T10-50-00-000Z',
        traceArtifactPath,
        `${JSON.stringify({
          resourceSpans: [
            {
              resource: {
                attributes: [{ key: 'service.name', value: { stringValue: 'agentv' } }],
              },
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId: 'trace-otlp',
                      spanId: 'root',
                      name: 'invoke_agent codex',
                      startTimeUnixNano: '1000000000',
                      endTimeUnixNano: '2000000000',
                      attributes: [
                        {
                          key: 'gen_ai.operation.name',
                          value: { stringValue: 'invoke_agent' },
                        },
                      ],
                      events: [
                        {
                          name: 'agentv.score',
                          timeUnixNano: '1900000000',
                          attributes: [{ key: 'agentv.grader.score', value: { doubleValue: 0.9 } }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        })}\n`,
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/trace-session`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        status: string;
        trace_path: string;
        trace_session: {
          test_id?: string;
          target?: string;
          resource_attributes?: Record<string, unknown>;
          artifact_links?: Array<{ name: string; path: string }>;
          spans: Array<{ span_id: string; name: string }>;
          events: Array<{ kind: string; score?: number }>;
        };
      };
      expect(data.status).toBe('ok');
      expect(data.trace_path).toBe(traceArtifactPath);
      expect(data.trace_session).toMatchObject({
        test_id: 'test-greeting',
        target: 'gpt-4o',
        resource_attributes: { 'service.name': 'agentv' },
      });
      expect(data.trace_session.artifact_links).toEqual([
        { name: 'raw_trace_path', path: traceArtifactPath },
      ]);
      expect(data.trace_session.spans[0]).toMatchObject({
        span_id: 'root',
        name: 'invoke_agent codex',
      });
      expect(data.trace_session.events[0]).toMatchObject({ kind: 'score', score: 0.9 });
    });

    it('rejects trace artifact paths that escape the run workspace', async () => {
      const secret = 'outside trace secret';
      writeFileSync(path.join(tempDir, 'outside-trace.json'), secret);
      const runsDir = localResultsExperimentDir(tempDir, 'escaped-trace');
      const runId = 'escaped-trace::2026-03-25T11-00-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T11-00-00-000Z');
      const artifactPath = '../../../../../outside-trace.json';

      mkdirSync(timestampDir, { recursive: true });
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'escaped-trace',
          trace_path: artifactPath,
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/trace-session`,
      );

      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).not.toContain(secret);
      const data = JSON.parse(text) as { status: string; trace_path: string };
      expect(data.status).toBe('rejected');
      expect(data.trace_path).toBe(artifactPath);
    });
  });

  describe('GET /api/runs/:filename/evals/:evalId/transcript', () => {
    it('loads canonical transcript JSONL lazily from the manifest pointer', async () => {
      const runsDir = localResultsExperimentDir(tempDir, 'with-transcript');
      const runId = 'with-transcript::2026-03-25T10-00-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T10-00-00-000Z');
      const transcriptArtifactPath = 'demo/test-greeting/transcript.jsonl';
      const answerArtifactPath = 'demo/test-greeting/outputs/answer.md';
      const transcriptPath = path.join(timestampDir, transcriptArtifactPath);
      const answerPath = path.join(timestampDir, answerArtifactPath);
      const transcriptJsonl = `${JSON.stringify({
        test_id: 'test-greeting',
        target: 'gpt-4o',
        message_index: 0,
        role: 'user',
        content: 'Hello',
      })}\n`;

      mkdirSync(path.dirname(transcriptPath), { recursive: true });
      writeFileSync(transcriptPath, transcriptJsonl);
      mkdirSync(path.dirname(answerPath), { recursive: true });
      writeFileSync(answerPath, 'Hello, Alice!');
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'with-transcript',
          transcript_path: transcriptArtifactPath,
          answer_path: answerArtifactPath,
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/transcript`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        status: string;
        transcript_path: string;
        content: string;
        answer_path: string;
        answer_content: string;
      };
      expect(data).toMatchObject({
        status: 'ok',
        transcript_path: transcriptArtifactPath,
        content: transcriptJsonl,
        answer_path: answerArtifactPath,
        answer_content: 'Hello, Alice!',
      });

      const filesRes = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/files`,
      );
      expect(filesRes.status).toBe(200);
      const filesData = (await filesRes.json()) as { files: Array<Record<string, unknown>> };
      const serializedFiles = JSON.stringify(filesData);
      expect(serializedFiles).toContain(transcriptArtifactPath);
      expect(serializedFiles).toContain(answerArtifactPath);
      expect(serializedFiles).toContain('"storage":"local"');
    });

    it('loads pointer-shaped transcript metadata when it resolves to a local artifact path', async () => {
      const runsDir = localResultsExperimentDir(tempDir, 'pointer-transcript');
      const runId = 'pointer-transcript::2026-03-25T11-00-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T11-00-00-000Z');
      const artifactPath = 'demo/test-greeting/transcript.jsonl';
      const transcriptPath = path.join(timestampDir, artifactPath);
      const transcriptJsonl = `${JSON.stringify({
        test_id: 'test-greeting',
        target: 'gpt-4o',
        message_index: 0,
        role: 'assistant',
        content: 'Hello',
      })}\n`;

      mkdirSync(path.dirname(transcriptPath), { recursive: true });
      writeFileSync(transcriptPath, transcriptJsonl);
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'pointer-transcript',
          artifact_pointers: {
            transcript: {
              ref: 'agentv/artifacts/v1',
              path: artifactPath,
            },
          },
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/transcript`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        status: string;
        transcript_path: string;
        content: string;
        pointer: string;
      };
      expect(data.status).toBe('ok');
      expect(data.transcript_path).toBe(artifactPath);
      expect(data.content).toBe(transcriptJsonl);
      expect(data.pointer).toContain('agentv/artifacts/v1');
    });

    it('resolves remote sidecar transcript and trace artifacts only on demand', async () => {
      const { remoteDir, cloneDir, seedDir } = initializeRemoteRepo(tempDir);
      const resultsBranch = 'dogfood/serve-sidecar-contract';
      const experiment = 'sidecar-only';
      const timestamp = '2026-03-25T15-00-00-000Z';
      const runId = `remote::${experiment}::${timestamp}`;
      const transcriptArtifactPath = 'demo/test-greeting/transcript.jsonl';
      const traceArtifactPath = 'demo/test-greeting/trace.json';
      const transcriptKey = `runs/${experiment}/${timestamp}/${transcriptArtifactPath}`;
      const traceKey = `runs/${experiment}/${timestamp}/${traceArtifactPath}`;
      const transcriptJsonl = `${JSON.stringify({
        schema_version: 'agentv.transcript.v1',
        test_id: 'test-greeting',
        target: 'gpt-4o',
        message_index: 0,
        role: 'assistant',
        content: 'sidecar transcript body',
      })}\n`;
      const traceJson = `${JSON.stringify(
        traceSessionEnvelope({
          runId,
          testId: 'test-greeting',
          target: 'gpt-4o',
          spanName: 'remote root',
        }),
      )}\n`;

      git(`git switch --quiet --orphan ${resultsBranch}`, seedDir);
      git('git rm -rf --quiet . 2>/dev/null || true', seedDir);
      const runDir = path.join(seedDir, 'runs', experiment, timestamp);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment,
          artifact_pointers: {
            trace: {
              ref: AGENTV_RESULTS_ARTIFACTS_REF,
              path: traceArtifactPath,
              key: traceKey,
            },
            transcript: {
              ref: AGENTV_RESULTS_ARTIFACTS_REF,
              path: transcriptArtifactPath,
              key: transcriptKey,
            },
          },
        }),
      );
      writeFileSync(
        path.join(runDir, 'benchmark.json'),
        JSON.stringify(
          {
            metadata: {
              timestamp: '2026-03-25T15:00:00.000Z',
              experiment,
              targets: ['gpt-4o'],
              tests_run: ['test-greeting'],
            },
            run_summary: { 'gpt-4o': { pass_rate: { mean: 1 } } },
          },
          null,
          2,
        ),
      );
      git('git add runs && git commit --quiet -m "seed metadata-only results"', seedDir);
      git(`git push --quiet origin HEAD:${resultsBranch}`, seedDir);

      git(`git switch --quiet --orphan ${AGENTV_RESULTS_ARTIFACTS_REF}`, seedDir);
      git('git rm -rf --quiet . 2>/dev/null || true', seedDir);
      const transcriptPath = path.join(seedDir, ...transcriptKey.split('/'));
      const tracePath = path.join(seedDir, ...traceKey.split('/'));
      mkdirSync(path.dirname(transcriptPath), { recursive: true });
      writeFileSync(transcriptPath, transcriptJsonl);
      writeFileSync(tracePath, traceJson);
      git('git add runs && git commit --quiet -m "seed artifact sidecars"', seedDir);
      git(`git push --quiet origin HEAD:${AGENTV_RESULTS_ARTIFACTS_REF}`, seedDir);
      git('git switch --quiet main', seedDir);

      writeResultsConfig(tempDir, {
        remote: `file://${remoteDir}`,
        branch: resultsBranch,
        path: cloneDir,
        autoPush: false,
      });

      const artifactRemoteRef = `refs/remotes/agentv-results/${AGENTV_RESULTS_ARTIFACTS_REF}`;
      const artifactRefLookup = () =>
        git(
          `git -C "${cloneDir}" show-ref --verify --quiet ${artifactRemoteRef} && echo present || true`,
          tempDir,
        );
      expect(artifactRefLookup()).toBe('');

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      expect(artifactRefLookup()).toBe('');

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(runId)}`);
      expect(detailRes.status).toBe(200);
      expect(await detailRes.text()).not.toContain('sidecar transcript body');
      expect(artifactRefLookup()).toBe('');
      expect(existsSync(path.join(cloneDir, ...transcriptKey.split('/')))).toBe(false);
      expect(existsSync(path.join(cloneDir, ...traceKey.split('/')))).toBe(false);

      const filesRes = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/files`,
      );
      expect(filesRes.status).toBe(200);
      const filesData = (await filesRes.json()) as { files: Array<Record<string, unknown>> };
      const serializedFiles = JSON.stringify(filesData);
      expect(serializedFiles).toContain(transcriptArtifactPath);
      expect(serializedFiles).toContain(traceArtifactPath);
      expect(serializedFiles).toContain(AGENTV_RESULTS_ARTIFACTS_REF);
      expect(serializedFiles).toContain(transcriptKey);

      const transcriptRes = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/transcript`,
      );
      expect(transcriptRes.status).toBe(200);
      const transcriptData = (await transcriptRes.json()) as {
        status: string;
        content: string;
        transcript_path: string;
      };
      expect(transcriptData.status).toBe('ok');
      expect(transcriptData.transcript_path).toBe(transcriptArtifactPath);
      expect(transcriptData.content).toBe(transcriptJsonl);
      expect(artifactRefLookup()).toBe('present');
      expect(existsSync(path.join(cloneDir, ...transcriptKey.split('/')))).toBe(false);

      const traceSessionRes = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/trace-session`,
      );
      expect(traceSessionRes.status).toBe(200);
      const traceSessionData = (await traceSessionRes.json()) as {
        status: string;
        trace_path: string;
        trace_session: { spans: Array<{ name: string }>; run_id?: string };
      };
      expect(traceSessionData.status).toBe('ok');
      expect(traceSessionData.trace_path).toBe(traceArtifactPath);
      expect(traceSessionData.trace_session.run_id).toBe(runId);
      expect(traceSessionData.trace_session.spans[0]?.name).toBe('remote root');
      expect(existsSync(path.join(cloneDir, ...traceKey.split('/')))).toBe(false);

      const transcriptRawRes = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/files/${transcriptArtifactPath}?raw=1`,
      );
      expect(transcriptRawRes.status).toBe(200);
      expect(transcriptRawRes.headers.get('content-type')).toContain('text/plain');
      expect(await transcriptRawRes.text()).toBe(transcriptJsonl);
      expect(existsSync(path.join(cloneDir, ...transcriptKey.split('/')))).toBe(false);

      const traceRes = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/files/${traceArtifactPath}?raw=1`,
      );
      expect(traceRes.status).toBe(200);
      expect(traceRes.headers.get('content-type')).toContain('application/json');
      expect(await traceRes.text()).toBe(traceJson);
      expect(existsSync(path.join(cloneDir, ...traceKey.split('/')))).toBe(false);
    }, 15000);

    it('returns a clear missing state when no transcript pointer is recorded', async () => {
      const runId = writeLocalRunArtifact(
        tempDir,
        'missing-transcript',
        '2026-03-25T12-00-00-000Z',
        RESULT_A,
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/transcript`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; message: string };
      expect(data.status).toBe('missing');
      expect(data.message).toContain('transcript.jsonl');
    });

    it('returns a clear dangling state when the transcript pointer cannot be read', async () => {
      const runsDir = localResultsExperimentDir(tempDir, 'dangling-transcript');
      const runId = 'dangling-transcript::2026-03-25T13-00-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T13-00-00-000Z');
      const artifactPath = 'demo/test-greeting/transcript.jsonl';

      mkdirSync(timestampDir, { recursive: true });
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'dangling-transcript',
          transcript_path: artifactPath,
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/transcript`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        status: string;
        transcript_path: string;
        message: string;
      };
      expect(data.status).toBe('dangling');
      expect(data.transcript_path).toBe(artifactPath);
      expect(data.message).toContain('not available');
    });

    it('treats symlinked transcript artifacts outside the run workspace as dangling', async () => {
      const secret = 'outside transcript secret';
      const outsidePath = path.join(tempDir, 'outside-transcript.jsonl');
      writeFileSync(outsidePath, secret);

      const runsDir = localResultsExperimentDir(tempDir, 'escaped-transcript');
      const runId = 'escaped-transcript::2026-03-25T13-30-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T13-30-00-000Z');
      const artifactPath = 'demo/test-greeting/transcript.jsonl';
      const symlinkPath = path.join(timestampDir, artifactPath);

      mkdirSync(path.dirname(symlinkPath), { recursive: true });
      symlinkSync(outsidePath, symlinkPath);
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'escaped-transcript',
          transcript_path: artifactPath,
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/transcript`,
      );

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(secret);
      const data = JSON.parse(text) as { status: string; transcript_path: string };
      expect(data.status).toBe('dangling');
      expect(data.transcript_path).toBe(artifactPath);
    });

    it('omits symlinked answer artifacts outside the run workspace from transcript responses', async () => {
      const secret = 'outside answer secret';
      const outsidePath = path.join(tempDir, 'outside-answer.md');
      writeFileSync(outsidePath, secret);

      const runsDir = localResultsExperimentDir(tempDir, 'escaped-answer');
      const runId = 'escaped-answer::2026-03-25T13-45-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T13-45-00-000Z');
      const transcriptArtifactPath = 'demo/test-greeting/transcript.jsonl';
      const answerArtifactPath = 'demo/test-greeting/outputs/answer.md';
      const transcriptPath = path.join(timestampDir, transcriptArtifactPath);
      const answerPath = path.join(timestampDir, answerArtifactPath);
      const transcriptJsonl = `${JSON.stringify({
        test_id: 'test-greeting',
        target: 'gpt-4o',
        message_index: 0,
        role: 'user',
        content: 'Hello',
      })}\n`;

      mkdirSync(path.dirname(transcriptPath), { recursive: true });
      writeFileSync(transcriptPath, transcriptJsonl);
      mkdirSync(path.dirname(answerPath), { recursive: true });
      symlinkSync(outsidePath, answerPath);
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'escaped-answer',
          transcript_path: transcriptArtifactPath,
          answer_path: answerArtifactPath,
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/transcript`,
      );

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(secret);
      const data = JSON.parse(text) as {
        status: string;
        content: string;
        answer_path: string;
        answer_content?: string;
      };
      expect(data.status).toBe('ok');
      expect(data.content).toBe(transcriptJsonl);
      expect(data.answer_path).toBe(answerArtifactPath);
      expect(data.answer_content).toBeUndefined();
    });

    it('does not read transcript or trace bodies for list, detail, or aggregate routes', async () => {
      const timestamp = '2026-03-25T14-00-00-000Z';
      const transcriptArtifactPath = 'demo/test-greeting/transcript.jsonl';
      const traceArtifactPath = 'demo/test-greeting/trace.json';
      const runId = writeLocalRunArtifact(tempDir, 'lazy-guard', timestamp, {
        ...RESULT_A,
        transcript_path: transcriptArtifactPath,
        trace_path: traceArtifactPath,
      });
      const timestampDir = path.join(
        tempDir,
        '.agentv',
        'results',
        'runs',
        'lazy-guard',
        timestamp,
      );
      mkdirSync(path.join(timestampDir, transcriptArtifactPath), { recursive: true });
      mkdirSync(path.dirname(path.join(timestampDir, traceArtifactPath)), { recursive: true });
      writeFileSync(
        path.join(timestampDir, traceArtifactPath),
        'malformed trace body that list routes must not parse',
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const listRes = await app.request('/api/runs');
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        runs: Array<{ filename: string; target?: string }>;
      };
      expect(listData.runs.find((run) => run.filename === runId)?.target).toBe('gpt-4o');

      const detailRes = await app.request(`/api/runs/${encodeURIComponent(runId)}`);
      expect(detailRes.status).toBe(200);
      const detailData = (await detailRes.json()) as { results: unknown[] };
      expect(detailData.results).toHaveLength(1);

      const compareRes = await app.request('/api/compare');
      expect(compareRes.status).toBe(200);
      const compareData = (await compareRes.json()) as {
        cells: Array<{ experiment: string; eval_count: number }>;
      };
      expect(compareData.cells.find((cell) => cell.experiment === 'lazy-guard')?.eval_count).toBe(
        1,
      );

      const indexRes = await app.request('/api/index');
      expect(indexRes.status).toBe(200);
      const indexData = (await indexRes.json()) as {
        entries: Array<{ run_filename: string; total_cost_usd: number }>;
      };
      expect(indexData.entries.find((entry) => entry.run_filename === runId)?.total_cost_usd).toBe(
        RESULT_A.cost_usd,
      );
    });
  });

  describe('GET /api/runs/:filename/evals/:evalId/files/*', () => {
    it('loads file content for experiment-scoped run ids', async () => {
      const runsDir = localResultsExperimentDir(tempDir, 'with-skills');
      const runId = 'with-skills::2026-03-25T10-00-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T10-00-00-000Z');
      const responsePath = path.join(
        timestampDir,
        'demo',
        'test-greeting',
        'outputs',
        'response.md',
      );

      mkdirSync(path.dirname(responsePath), { recursive: true });
      writeFileSync(responsePath, '@[assistant]:\nHello, Alice!');
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'with-skills',
          output_path: 'demo/test-greeting/outputs/response.md',
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/files/demo/test-greeting/outputs/response.md`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { content: string };
      expect(data.content).toContain('Hello, Alice!');
    });

    it('serves transcript JSONL artifacts as browser-visible raw text and downloads', async () => {
      const runsDir = localResultsExperimentDir(tempDir, 'with-transcript');
      const runId = 'with-transcript::2026-03-25T10-00-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T10-00-00-000Z');
      const artifactPath = 'demo/test-greeting/transcript.jsonl';
      const transcriptPath = path.join(timestampDir, artifactPath);
      const transcriptJsonl = `${JSON.stringify({
        test_id: 'test-greeting',
        target: 'gpt-4o',
        message_index: 0,
        role: 'user',
        content: 'Hello',
      })}\n`;

      mkdirSync(path.dirname(transcriptPath), { recursive: true });
      writeFileSync(transcriptPath, transcriptJsonl);
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'with-transcript',
          transcript_path: artifactPath,
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const artifactUrl = `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/files/${artifactPath}`;

      const rawRes = await app.request(`${artifactUrl}?raw=1`);
      expect(rawRes.status).toBe(200);
      expect(rawRes.headers.get('content-type')).toContain('text/plain');
      expect(await rawRes.text()).toBe(transcriptJsonl);

      const downloadRes = await app.request(`${artifactUrl}?download=1`);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get('content-disposition')).toBe(
        'attachment; filename="transcript.jsonl"',
      );
      expect(await downloadRes.text()).toBe(transcriptJsonl);
    });

    it('rejects symlinked artifact file reads outside the run workspace', async () => {
      const secret = 'outside raw artifact secret';
      const outsidePath = path.join(tempDir, 'outside-response.md');
      writeFileSync(outsidePath, secret);

      const runsDir = localResultsExperimentDir(tempDir, 'escaped-file');
      const runId = 'escaped-file::2026-03-25T10-30-00-000Z';
      const timestampDir = path.join(runsDir, '2026-03-25T10-30-00-000Z');
      const artifactPath = 'demo/test-greeting/outputs/response.md';
      const symlinkPath = path.join(timestampDir, artifactPath);

      mkdirSync(path.dirname(symlinkPath), { recursive: true });
      symlinkSync(outsidePath, symlinkPath);
      writeFileSync(
        path.join(timestampDir, 'index.jsonl'),
        toJsonl({
          ...RESULT_A,
          experiment: 'escaped-file',
          output_path: artifactPath,
        }),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(
        `/api/runs/${encodeURIComponent(runId)}/evals/test-greeting/files/${artifactPath}?raw=1`,
      );

      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain(secret);
    });
  });

  // ── GET /api/compare (tag filter) ───────────────────────────────────

  describe('GET /api/compare', () => {
    function seedCompareFixture() {
      // Four runs, each in its own run workspace, with the tags documented
      // below. This setup exercises the OR filter semantics used by
      // `/api/compare?tags=`.
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });

      const runs: Array<{
        name: string;
        experiment: string;
        target: string;
        category: string;
        score: number;
        tags?: string[];
      }> = [
        {
          name: '2026-04-01T10-00-00-000Z',
          experiment: 'exp-a',
          target: 'gpt-4o',
          category: 'baseline',
          score: 1.0,
          tags: ['baseline'],
        },
        {
          name: '2026-04-02T10-00-00-000Z',
          experiment: 'exp-a',
          target: 'claude',
          category: 'baseline',
          score: 0.9,
          tags: ['baseline'],
        },
        {
          name: '2026-04-03T10-00-00-000Z',
          experiment: 'exp-b',
          target: 'gpt-4o',
          category: 'prompting',
          score: 0.85,
          tags: ['v2-prompt'],
        },
        {
          // Intentionally untagged — should never match any tag filter.
          name: '2026-04-04T10-00-00-000Z',
          experiment: 'exp-b',
          target: 'claude',
          category: 'prompting',
          score: 0.7,
        },
      ];

      for (const run of runs) {
        const runDir = path.join(runsDir, run.name);
        mkdirSync(runDir, { recursive: true });
        writeFileSync(
          path.join(runDir, 'index.jsonl'),
          toJsonl({
            ...RESULT_A,
            test_id: `test-${run.name}`,
            experiment: run.experiment,
            target: run.target,
            category: run.category,
            score: run.score,
          }),
        );
        if (run.tags && run.tags.length > 0) {
          writeFileSync(
            path.join(runDir, 'tags.json'),
            `${JSON.stringify({ tags: run.tags, updated_at: '2026-04-10T00:00:00.000Z' }, null, 2)}\n`,
          );
        }
      }
    }

    type CompareJson = {
      experiments: string[];
      targets: string[];
      cells: Array<{
        experiment: string;
        target: string;
        eval_count: number;
        tests?: Array<{ test_id: string; category?: string }>;
      }>;
      runs?: Array<{
        run_id: string;
        experiment: string;
        target: string;
        tags?: string[];
        tests?: Array<{ test_id: string; category?: string }>;
      }>;
    };

    it('returns all runs when no filter is provided', async () => {
      seedCompareFixture();
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const res = await app.request('/api/compare');
      expect(res.status).toBe(200);
      const data = (await res.json()) as CompareJson;

      expect(data.runs).toHaveLength(4);
      expect(data.experiments.sort()).toEqual(['exp-a', 'exp-b']);
      expect(data.targets.sort()).toEqual(['claude', 'gpt-4o']);
      expect(data.cells).toHaveLength(4);
    });

    it('preserves per-test category metadata in compare cells and runs', async () => {
      seedCompareFixture();
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const res = await app.request('/api/compare');
      expect(res.status).toBe(200);
      const data = (await res.json()) as CompareJson;

      const cell = data.cells.find((c) => c.experiment === 'exp-b' && c.target === 'gpt-4o');
      const run = data.runs?.find((r) => r.experiment === 'exp-b' && r.target === 'gpt-4o');
      expect(cell?.tests?.[0]?.category).toBe('prompting');
      expect(run?.tests?.[0]?.category).toBe('prompting');
    });

    it('filters to a single tag', async () => {
      seedCompareFixture();
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const res = await app.request('/api/compare?tags=baseline');
      expect(res.status).toBe(200);
      const data = (await res.json()) as CompareJson;

      expect(data.runs).toHaveLength(2);
      for (const run of data.runs ?? []) {
        expect(run.tags ?? []).toContain('baseline');
      }
      // Only exp-a is represented; targets narrow to the two used by exp-a runs.
      expect(data.experiments).toEqual(['exp-a']);
      expect(data.targets.sort()).toEqual(['claude', 'gpt-4o']);
      expect(data.cells).toHaveLength(2);
    });

    it('applies OR semantics across multiple tags', async () => {
      seedCompareFixture();
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const res = await app.request('/api/compare?tags=baseline,v2-prompt');
      expect(res.status).toBe(200);
      const data = (await res.json()) as CompareJson;

      // Three tagged runs; the untagged run is excluded.
      expect(data.runs).toHaveLength(3);
      expect(data.experiments.sort()).toEqual(['exp-a', 'exp-b']);
      // (exp-a, gpt-4o), (exp-a, claude), (exp-b, gpt-4o) — the (exp-b, claude)
      // cell is missing because the only contributing run was untagged.
      expect(data.cells).toHaveLength(3);
      const cellKeys = (data.cells ?? []).map((c) => `${c.experiment}::${c.target}`).sort();
      expect(cellKeys).toEqual(['exp-a::claude', 'exp-a::gpt-4o', 'exp-b::gpt-4o']);
    });

    it('returns empty payload when no runs match the filter', async () => {
      seedCompareFixture();
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      const res = await app.request('/api/compare?tags=nonexistent');
      expect(res.status).toBe(200);
      const data = (await res.json()) as CompareJson;

      expect(data.runs).toEqual([]);
      expect(data.cells).toEqual([]);
      expect(data.experiments).toEqual([]);
      expect(data.targets).toEqual([]);
    });

    it('ignores whitespace and empty segments in the tags query', async () => {
      seedCompareFixture();
      const app = createApp([], tempDir, tempDir, undefined, { studioDir });

      // ` , baseline , ` should parse to just ['baseline'].
      const res = await app.request('/api/compare?tags=%20,%20baseline%20,%20');
      expect(res.status).toBe(200);
      const data = (await res.json()) as CompareJson;
      expect(data.runs).toHaveLength(2);
    });
  });

  // ── SPA fallback ──────────────────────────────────────────────────────

  describe('SPA fallback', () => {
    it('serves index.html for non-API routes', async () => {
      const app = makeApp();
      const res = await app.request('/runs/some-run');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('agentv');
    });

    it('returns 404 JSON for unknown API routes', async () => {
      const app = makeApp();
      const res = await app.request('/api/nonexistent');
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe('Not found');
    });
  });

  // ── POST /api/eval/run — resume / rerun-failed / retry-errors ─────────
  //
  // These tests assert the launch endpoint accepts the resume-family fields,
  // translates them to CLI flags in the `command` preview returned to the
  // client, validates mutual exclusivity, and respects the read-only guard.
  // They do not depend on the spawned child process — once the request is
  // accepted and the command is built, we have validated the contract.

  describe('POST /api/eval/run (resume API)', () => {
    function makeAppForRun(opts?: { readOnly?: boolean }) {
      return createApp([], tempDir, undefined, undefined, {
        studioDir,
        readOnly: opts?.readOnly === true,
      });
    }

    it('builds --resume + --output flags from the request', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          target: 'gpt-4o',
          output: '.agentv/results/default/2026-05-06T00-00-00-000Z',
          resume: true,
        }),
      });
      // resolveCliPath must resolve in the test env via the running-process
      // fallback (apps/cli/src/cli.ts is two dirs up from this module). A
      // 500 here would mean the off-by-one regression from #1221 came back.
      expect(res.status).toBe(202);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--resume');
      expect(data.command).toContain('--output .agentv/results/default/2026-05-06T00-00-00-000Z');
    });

    it('builds --rerun-failed + --output flags from the request', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          target: 'gpt-4o',
          output: '.agentv/results/default/r1',
          rerun_failed: true,
        }),
      });
      expect(res.status).toBe(202);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--rerun-failed');
      expect(data.command).toContain('--output .agentv/results/default/r1');
    });

    it('builds a selected experiment output path and writes initial tags beside the new run', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          experiment: 'smoke',
          tags: [' baseline ', 'baseline', 'prompt-v2'],
        }),
      });

      expect(res.status).toBe(202);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--experiment smoke');
      expect(data.command).toContain(path.join('.agentv', 'results', 'smoke'));
      const outputDir = data.command.match(/--output ([^\s]+)/)?.[1];
      expect(outputDir).toBeString();

      const tagFile = JSON.parse(
        readFileSync(path.join(outputDir as string, 'tags.json'), 'utf8'),
      ) as {
        tags: string[];
      };
      expect(tagFile.tags).toEqual(['baseline', 'prompt-v2']);
    });

    it('builds --retry-errors <path> from the request', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          retry_errors: '.agentv/results/default/r0/index.jsonl',
        }),
      });
      expect(res.status).toBe(202);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--retry-errors .agentv/results/default/r0/index.jsonl');
    });

    it('rejects resume + rerun_failed combo with 400', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          output: '.agentv/results/default/r1',
          resume: true,
          rerun_failed: true,
        }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain('mutually exclusive');
    });

    it('rejects resume + retry_errors combo with 400', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          output: '.agentv/results/default/r1',
          resume: true,
          retry_errors: '.agentv/results/default/r0/index.jsonl',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects initial tags when resuming an existing run', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          output: '.agentv/results/default/r1',
          resume: true,
          tags: ['baseline'],
        }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain('creating a new run');
    });

    it('returns 403 in read-only mode for unscoped /api/eval/run', async () => {
      const app = makeAppForRun({ readOnly: true });
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          resume: true,
          output: '.agentv/results/default/r1',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 403 in read-only mode for project-scoped /api/projects/:id/eval/run', async () => {
      const app = makeAppForRun({ readOnly: true });
      const res = await app.request('/api/projects/some-id/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          resume: true,
          output: '.agentv/results/default/r1',
        }),
      });
      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/eval/run/:id/stop — interrupt a running eval ─────────────
  //
  // Stop is part of the stop → resume workflow, not a destructive cancel —
  // POST (not DELETE) and idempotent on already-terminal runs. These tests
  // validate routing/auth shape (404 unknown id, 403 read-only). The happy
  // path SIGTERM behavior is covered by manual UAT because it requires a
  // live subprocess that is reliably mid-run; unit tests that race a launch
  // against a stop are flaky.

  describe('POST /api/eval/run/:id/stop (stop API)', () => {
    function makeAppForStop(opts?: { readOnly?: boolean }) {
      return createApp([], tempDir, undefined, undefined, {
        studioDir,
        readOnly: opts?.readOnly === true,
      });
    }

    it('returns 404 for an unknown run id', async () => {
      const app = makeAppForStop();
      const res = await app.request('/api/eval/run/no-such-id/stop', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 403 in read-only mode', async () => {
      const app = makeAppForStop({ readOnly: true });
      const res = await app.request('/api/eval/run/anything/stop', { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('returns 404 for benchmark-scoped stop with unknown run id', async () => {
      const app = makeAppForStop();
      const res = await app.request('/api/projects/some-id/eval/run/no-such-id/stop', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });

    it('returns 403 in read-only mode for benchmark-scoped stop', async () => {
      const app = makeAppForStop({ readOnly: true });
      const res = await app.request('/api/projects/some-id/eval/run/anything/stop', {
        method: 'POST',
      });
      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/eval/preview — argument shaping for resume flags ─────────
  //
  // /api/eval/preview is a lightweight endpoint that returns the CLI
  // command without spawning anything. Use it to assert the exact CLI
  // surface produced by the new fields independent of test-host CLI state.

  describe('POST /api/eval/preview (resume API)', () => {
    it('emits --resume and --output for resume:true requests', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/eval/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          target: 'gpt-4o',
          output: '.agentv/results/default/r1',
          resume: true,
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--resume');
      expect(data.command).toContain('--output .agentv/results/default/r1');
      expect(data.command).not.toContain('--rerun-failed');
    });

    it('emits --rerun-failed for rerun_failed:true requests', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/eval/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          output: '.agentv/results/default/r1',
          rerun_failed: true,
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--rerun-failed');
      expect(data.command).not.toContain('--resume');
    });

    it('emits --retry-errors <path> for retry_errors requests', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/eval/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          retry_errors: '.agentv/results/default/r0/index.jsonl',
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--retry-errors .agentv/results/default/r0/index.jsonl');
    });

    it('emits --experiment for selected experiment requests', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/eval/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          experiment: 'smoke',
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--experiment smoke');
    });

    it('rejects invalid experiment and tag values', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const badExperiment = await app.request('/api/eval/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          experiment: 'bad/name',
        }),
      });
      expect(badExperiment.status).toBe(400);

      const badTag = await app.request('/api/eval/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          tags: ['good', 'bad\nvalue'],
        }),
      });
      expect(badTag.status).toBe(400);
    });
  });

  // ── GET /api/runs/:filename — run_dir + suite_filter for resume UI ─────
  //
  // The Dashboard "Resume run" / "Rerun failed cases" buttons need the run dir
  // and the original eval file path to issue a launch request that targets
  // the same run workspace. handleRunDetail reads benchmark.json's
  // metadata.eval_file and reports the run dir relative to cwd.

  describe('GET /api/runs/:filename (resume metadata)', () => {
    it('includes run_dir and suite_filter for local runs with benchmark.json', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-05-06T00-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));
      writeFileSync(
        path.join(runDir, 'benchmark.json'),
        JSON.stringify(
          {
            metadata: {
              eval_file: 'examples/demo.eval.yaml',
              timestamp: '2026-05-06T00:00:00.000Z',
              targets: ['gpt-4o'],
              tests_run: ['test-greeting'],
            },
            run_summary: {},
            notes: [],
          },
          null,
          2,
        ),
      );

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(`/api/runs/${filename}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        run_dir?: string;
        suite_filter?: string;
        source: 'local' | 'remote';
      };
      expect(data.source).toBe('local');
      expect(data.run_dir).toBe(path.join('.agentv', 'results', 'default', filename));
      expect(data.suite_filter).toBe('examples/demo.eval.yaml');
    });

    it('omits suite_filter when benchmark.json is missing', async () => {
      const runsDir = localResultsExperimentDir(tempDir);
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-05-06T00-00-01-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request(`/api/runs/${filename}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { run_dir?: string; suite_filter?: string };
      expect(data.run_dir).toBeDefined();
      expect(data.suite_filter).toBeUndefined();
    });
  });
});
