import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { addProject, saveProjectRegistry } from '@agentv/core';

import {
  createApp,
  loadResults,
  resolveDashboardMode,
  resolveSourceFile,
} from '../../../src/commands/results/serve.js';

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

function toJsonl(...records: object[]): string {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
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
  resultRecord: object,
): string {
  const isoTimestamp = timestamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
  const runDir = path.join(cloneDir, '.agentv', 'results', 'runs', experiment, timestamp);
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
  git(`git add "${runDir}" && git commit --quiet -m "add ${experiment}"`, cloneDir);
  git('git push --quiet origin main', cloneDir);
  git('git fetch --quiet origin --prune', cloneDir);
  return `${experiment}::${timestamp}`;
}

// ── resolveSourceFile ────────────────────────────────────────────────────

describe('resolveSourceFile', () => {
  it('throws for nonexistent file', async () => {
    await expect(resolveSourceFile('/tmp/does-not-exist.jsonl', '/tmp')).rejects.toThrow(
      'Source file not found',
    );
  });

  it('rejects legacy flat result files', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-serve-source-'));
    const flatFile = path.join(tempDir, 'results.jsonl');
    writeFileSync(flatFile, toJsonl(RESULT_A));

    await expect(resolveSourceFile(flatFile, tempDir)).rejects.toThrow(
      'Expected a run workspace directory or index.jsonl manifest',
    );

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
      const runDir = path.join(baseDir, '.agentv', 'results', 'runs', filename);
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
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(RESULT_A));

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request('/api/runs');

      expect(res.status).toBe(200);
      const data = (await res.json()) as { runs: Array<{ filename: string; source: string }> };
      expect(data.runs).toHaveLength(1);
      expect(data.runs[0]).toMatchObject({
        filename,
        source: 'local',
      });
    });

    it('computes pass_rate using the configured dashboard threshold', async () => {
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
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

    it('infers the experiment name from the run id when live results have not written it yet', async () => {
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs', 'issue-1198-live-name');
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
        mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
        writeFileSync(
          path.join(tempDir, '.agentv', 'config.yaml'),
          `results:
  mode: github
  repo: EntityProcess/agentv-evals
`,
        );

        const remoteRunDir = path.join(
          process.env.AGENTV_HOME,
          'results',
          'EntityProcess-agentv-evals',
          '.agentv',
          'results',
          'runs',
          'default',
          '2026-03-26T10-00-00-000Z',
        );
        mkdirSync(remoteRunDir, { recursive: true });
        writeFileSync(path.join(remoteRunDir, 'index.jsonl'), toJsonl(RESULT_A));

        const app = createApp([], tempDir, tempDir, undefined, { studioDir });
        const res = await app.request('/api/runs');

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          runs: Array<{ filename: string; source: string }>;
        };
        expect(data.runs).toHaveLength(1);
        expect(data.runs[0]).toMatchObject({
          filename: 'remote::2026-03-26T10-00-00-000Z',
          source: 'remote',
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

      mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
      writeFileSync(
        path.join(tempDir, '.agentv', 'config.yaml'),
        `results:
  mode: github
  repo: file://${remoteDir}
  path: ${cloneDir}
`,
      );

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

    it('loads externally pushed remote runs after sync even when the clone has not checked out the files', async () => {
      const { remoteDir, cloneDir, seedDir } = initializeRemoteRepo(tempDir);
      const runId = writeRemoteRunArtifact(
        seedDir,
        'external-sync',
        '2026-03-26T11-00-00-000Z',
        RESULT_A,
      );

      mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
      writeFileSync(
        path.join(tempDir, '.agentv', 'config.yaml'),
        `results:
  mode: github
  repo: file://${remoteDir}
  path: ${cloneDir}
`,
      );

      const runManifestPath = path.join(
        cloneDir,
        '.agentv',
        'results',
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
  });

  describe('GET /api/projects/all-runs', () => {
    it('infers experiment names for live benchmark runs before records persist them', async () => {
      const homedirSpy = spyOn(os, 'homedir').mockReturnValue(path.join(tempDir, 'home'));

      try {
        const benchmarkDir = path.join(tempDir, 'bench-one');
        const runDir = path.join(
          benchmarkDir,
          '.agentv',
          'results',
          'runs',
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
        mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
        writeFileSync(
          path.join(tempDir, '.agentv', 'config.yaml'),
          `results:
  mode: github
  repo: EntityProcess/agentv-evals
`,
        );

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

    it('uses AGENTV_HOME results_by_project for project-scoped remote status', async () => {
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
        writeFileSync(
          path.join(homeDir, 'config.yaml'),
          `results_by_project:
  agentv:
    mode: github
    repo: EntityProcess/agentv-examples-eval-results
    path: /home/entity/projects/EntityProcess/agentv-examples-eval-results
    auto_push: true
results:
  mode: github
  repo: EntityProcess/fallback-results
`,
        );
        saveProjectRegistry({
          projects: [
            {
              id: 'agentv',
              name: 'AgentV',
              path: projectDir,
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
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
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
  });

  describe('GET /api/runs/:filename/evals/:evalId/files/*', () => {
    it('loads file content for experiment-scoped run ids', async () => {
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs', 'with-skills');
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
  });

  // ── GET /api/compare (tag filter) ───────────────────────────────────

  describe('GET /api/compare', () => {
    function seedCompareFixture() {
      // Four runs, each in its own run workspace, with the tags documented
      // below. This setup exercises the OR filter semantics used by
      // `/api/compare?tags=`.
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
      mkdirSync(runsDir, { recursive: true });

      const runs: Array<{
        name: string;
        experiment: string;
        target: string;
        score: number;
        tags?: string[];
      }> = [
        {
          name: '2026-04-01T10-00-00-000Z',
          experiment: 'exp-a',
          target: 'gpt-4o',
          score: 1.0,
          tags: ['baseline'],
        },
        {
          name: '2026-04-02T10-00-00-000Z',
          experiment: 'exp-a',
          target: 'claude',
          score: 0.9,
          tags: ['baseline'],
        },
        {
          name: '2026-04-03T10-00-00-000Z',
          experiment: 'exp-b',
          target: 'gpt-4o',
          score: 0.85,
          tags: ['v2-prompt'],
        },
        {
          // Intentionally untagged — should never match any tag filter.
          name: '2026-04-04T10-00-00-000Z',
          experiment: 'exp-b',
          target: 'claude',
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
      cells: Array<{ experiment: string; target: string; eval_count: number }>;
      runs?: Array<{ run_id: string; experiment: string; target: string; tags?: string[] }>;
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
          output: '.agentv/results/runs/2026-05-06T00-00-00-000Z',
          resume: true,
        }),
      });
      // resolveCliPath must resolve in the test env via the running-process
      // fallback (apps/cli/src/cli.ts is two dirs up from this module). A
      // 500 here would mean the off-by-one regression from #1221 came back.
      expect(res.status).toBe(202);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--resume');
      expect(data.command).toContain('--output .agentv/results/runs/2026-05-06T00-00-00-000Z');
    });

    it('builds --rerun-failed + --output flags from the request', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          target: 'gpt-4o',
          output: 'runs/r1',
          rerun_failed: true,
        }),
      });
      expect(res.status).toBe(202);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--rerun-failed');
      expect(data.command).toContain('--output runs/r1');
    });

    it('builds --retry-errors <path> from the request', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          retry_errors: 'runs/r0/index.jsonl',
        }),
      });
      expect(res.status).toBe(202);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--retry-errors runs/r0/index.jsonl');
    });

    it('rejects resume + rerun_failed combo with 400', async () => {
      const app = makeAppForRun();
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          output: 'runs/r1',
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
          output: 'runs/r1',
          resume: true,
          retry_errors: 'runs/r0/index.jsonl',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 403 in read-only mode for unscoped /api/eval/run', async () => {
      const app = makeAppForRun({ readOnly: true });
      const res = await app.request('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          resume: true,
          output: 'runs/r1',
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
          output: 'runs/r1',
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
          output: 'runs/r1',
          resume: true,
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--resume');
      expect(data.command).toContain('--output runs/r1');
      expect(data.command).not.toContain('--rerun-failed');
    });

    it('emits --rerun-failed for rerun_failed:true requests', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/eval/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite_filter: 'examples/demo.eval.yaml',
          output: 'runs/r1',
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
          retry_errors: 'runs/r0/index.jsonl',
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { command: string };
      expect(data.command).toContain('--retry-errors runs/r0/index.jsonl');
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
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
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
      expect(data.run_dir).toBe(path.join('.agentv', 'results', 'runs', filename));
      expect(data.suite_filter).toBe('examples/demo.eval.yaml');
    });

    it('omits suite_filter when benchmark.json is missing', async () => {
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
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
