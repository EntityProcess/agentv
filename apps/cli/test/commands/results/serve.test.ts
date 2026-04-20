import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  it('defaults to single-benchmark mode when no benchmarks are registered', () => {
    expect(resolveDashboardMode(0, {})).toEqual({
      isMultiBenchmark: false,
      showMultiWarning: false,
    });
  });

  it('defaults to single-benchmark mode when exactly one benchmark is registered', () => {
    expect(resolveDashboardMode(1, {})).toEqual({
      isMultiBenchmark: false,
      showMultiWarning: false,
    });
  });

  it('defaults to multi-benchmark mode when multiple benchmarks are registered', () => {
    expect(resolveDashboardMode(2, {})).toEqual({
      isMultiBenchmark: true,
      showMultiWarning: false,
    });
  });

  it('forces multi-benchmark mode with a deprecation warning when --multi is used', () => {
    expect(resolveDashboardMode(1, { multi: true })).toEqual({
      isMultiBenchmark: true,
      showMultiWarning: true,
    });
  });

  it('forces single-benchmark mode when --single is used', () => {
    expect(resolveDashboardMode(3, { single: true })).toEqual({
      isMultiBenchmark: false,
      showMultiWarning: false,
    });
  });

  it('lets --single override --multi', () => {
    expect(resolveDashboardMode(3, { multi: true, single: true })).toEqual({
      isMultiBenchmark: false,
      showMultiWarning: true,
    });
  });
});

// ── Mock studio dist ─────────────────────────────────────────────────────

const MOCK_STUDIO_HTML = `<!doctype html>
<html lang="en" class="dark">
<head><title>AgentV Studio</title></head>
<body class="bg-gray-950 text-gray-100"><div id="root"></div></body>
</html>`;

function createMockStudioDir(baseDir: string): string {
  const studioDir = path.join(baseDir, 'studio-dist');
  mkdirSync(studioDir, { recursive: true });
  writeFileSync(path.join(studioDir, 'index.html'), MOCK_STUDIO_HTML);
  return studioDir;
}

// ── Hono app (Studio SPA + API) ─────────────────────────────────────────

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
      ).toThrow('Studio dist not found');
    });
  });

  // ── GET / ──────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('serves Studio SPA index.html', async () => {
      const app = makeApp();
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('AgentV Studio');
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
    it('includes read_only mode in the config payload', async () => {
      const content = toJsonl(RESULT_A, RESULT_B);
      const results = loadResults(content);
      const app = createApp(results, tempDir, undefined, undefined, {
        studioDir,
        readOnly: true,
        multiBenchmarkDashboard: true,
      });

      const res = await app.request('/api/config');
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        read_only?: boolean;
        multi_benchmark_dashboard?: boolean;
      };
      expect(data.read_only).toBe(true);
      expect(data.multi_benchmark_dashboard).toBe(true);
    });
  });

  // ── Empty state (no results) ────────────────────────────────────────

  describe('empty state', () => {
    it('serves Studio SPA with empty results', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('AgentV Studio');
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
    it('returns empty runs list for temp directory', async () => {
      const app = createApp([], tempDir, undefined, undefined, { studioDir });
      const res = await app.request('/api/runs');
      expect(res.status).toBe(200);
      const data = (await res.json()) as { runs: unknown[] };
      expect(data.runs).toEqual([]);
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

    it('computes pass_rate using the configured studio threshold (strict threshold yields lower rate)', async () => {
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T10-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      // Two results: score=0.8 and score=0.6
      // With DEFAULT_THRESHOLD=0.8: score=0.8 passes → 1/2 = 50%
      // With threshold=0.9: neither passes → 0%
      const resultHigh = { ...RESULT_A, test_id: 'high', score: 0.8 };
      const resultLow = { ...RESULT_B, test_id: 'low', score: 0.6 };
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(resultHigh, resultLow));

      mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
      writeFileSync(path.join(tempDir, '.agentv', 'config.yaml'), 'studio:\n  threshold: 0.9\n');

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request('/api/runs');
      expect(res.status).toBe(200);
      const data = (await res.json()) as { runs: Array<{ pass_rate: number }> };
      expect(data.runs).toHaveLength(1);
      // With threshold=0.9: neither 0.8 nor 0.6 passes → 0%
      expect(data.runs[0].pass_rate).toBe(0);
    });

    it('computes pass_rate using the configured studio threshold (lenient threshold yields higher rate)', async () => {
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
      mkdirSync(runsDir, { recursive: true });
      const filename = '2026-03-25T12-00-00-000Z';
      const runDir = path.join(runsDir, filename);
      mkdirSync(runDir, { recursive: true });
      // Two results: score=0.8 and score=0.6
      // With DEFAULT_THRESHOLD=0.8: score=0.8 passes → 1/2 = 50%
      // With threshold=0.5: both pass → 2/2 = 100%
      const resultHigh = { ...RESULT_A, test_id: 'high', score: 0.8 };
      const resultLow = { ...RESULT_B, test_id: 'low', score: 0.6 };
      writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(resultHigh, resultLow));

      mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
      writeFileSync(path.join(tempDir, '.agentv', 'config.yaml'), 'studio:\n  threshold: 0.5\n');

      const app = createApp([], tempDir, tempDir, undefined, { studioDir });
      const res = await app.request('/api/runs');
      expect(res.status).toBe(200);
      const data = (await res.json()) as { runs: Array<{ pass_rate: number }> };
      expect(data.runs).toHaveLength(1);
      // With threshold=0.5: both 0.8 and 0.6 pass → 100%
      expect(data.runs[0].pass_rate).toBe(1);
    });

    it('merges cached remote runs and tags them with remote source metadata', async () => {
      const previousHome = process.env.AGENTV_HOME;
      process.env.AGENTV_HOME = path.join(tempDir, 'agentv-home');

      try {
        mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
        writeFileSync(
          path.join(tempDir, '.agentv', 'config.yaml'),
          `results:
  export:
    repo: EntityProcess/agentv-evals
    path: autopilot-dev/runs
`,
        );

        const remoteRunDir = path.join(
          process.env.AGENTV_HOME,
          'cache',
          'results-repo',
          'EntityProcess-agentv-evals',
          'repo',
          'autopilot-dev',
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
  });

  describe('GET /api/remote/status', () => {
    it('reports configured remote status with graceful local-only fallback', async () => {
      mkdirSync(path.join(tempDir, '.agentv'), { recursive: true });
      writeFileSync(
        path.join(tempDir, '.agentv', 'config.yaml'),
        `results:
  export:
    repo: EntityProcess/agentv-evals
    path: autopilot-dev/runs
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
      expect(data.path).toBe('autopilot-dev/runs');
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
      expect(html).toContain('AgentV Studio');
    });

    it('returns 404 JSON for unknown API routes', async () => {
      const app = makeApp();
      const res = await app.request('/api/nonexistent');
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe('Not found');
    });
  });
});
