import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp, loadResults, resolveSourceFile } from '../../../src/commands/results/serve.js';

// ── Sample JSONL content (snake_case, matching on-disk format) ──────────

const RESULT_A = {
  timestamp: '2026-03-18T10:00:01.000Z',
  test_id: 'test-greeting',
  dataset: 'demo',
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
  dataset: 'demo',
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

// ── Hono app (feedback API + HTML) ───────────────────────────────────────

describe('serve app', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-serve-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Disable SPA serving in tests so inline HTML dashboard assertions pass */
  const noStudio = { studioDir: false as const };

  function makeApp() {
    const content = toJsonl(RESULT_A, RESULT_B);
    const results = loadResults(content);
    return createApp(results, tempDir, undefined, undefined, noStudio);
  }

  // ── GET / ──────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns HTML with "AgentV" and "Results Review"', async () => {
      const app = makeApp();
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('AgentV');
      expect(html).toContain('Results Review');
    });

    it('does not contain meta-refresh', async () => {
      const app = makeApp();
      const res = await app.request('/');
      const html = await res.text();
      expect(html).not.toContain('meta http-equiv="refresh"');
    });

    it('contains data-test-id attributes', async () => {
      const app = makeApp();
      const res = await app.request('/');
      const html = await res.text();
      expect(html).toContain('data-test-id');
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
  });

  // ── Empty state (no results) ────────────────────────────────────────

  describe('empty state', () => {
    it('serves dashboard HTML with empty results', async () => {
      const app = createApp([], tempDir, undefined, undefined, noStudio);
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('AgentV');
      expect(html).toContain('No results yet');
      expect(html).toContain('Run an evaluation');
    });

    it('serves feedback API with empty results', async () => {
      const app = createApp([], tempDir, undefined, undefined, noStudio);
      const res = await app.request('/api/feedback');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ reviews: [] });
    });
  });

  // ── GET /api/runs ───────────────────────────────────────────────────

  describe('GET /api/runs', () => {
    it('returns empty runs list for temp directory', async () => {
      const app = createApp([], tempDir, undefined, undefined, noStudio);
      const res = await app.request('/api/runs');
      expect(res.status).toBe(200);
      const data = (await res.json()) as { runs: unknown[] };
      expect(data.runs).toEqual([]);
    });
  });

  // ── GET /api/runs/:filename ─────────────────────────────────────────

  describe('GET /api/runs/:filename', () => {
    it('returns 404 for nonexistent run', async () => {
      const app = createApp([], tempDir, undefined, undefined, noStudio);
      const res = await app.request('/api/runs/nonexistent');
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe('Run not found');
    });

    it('loads results from an existing run file', async () => {
      const runsDir = path.join(tempDir, '.agentv', 'results', 'runs');
      mkdirSync(runsDir, { recursive: true });
      const filename = 'eval_2026-03-25T10-00-00-000Z.jsonl';
      writeFileSync(path.join(runsDir, filename), toJsonl(RESULT_A, RESULT_B));

      const app = createApp([], tempDir, tempDir, undefined, noStudio);
      const res = await app.request(`/api/runs/${filename}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: { testId: string }[]; source: string };
      expect(data.results).toHaveLength(2);
      expect(data.results[0].testId).toBe('test-greeting');
      expect(data.source).toBe(filename);
    });
  });

  // ── Run picker in HTML ──────────────────────────────────────────────

  describe('run picker', () => {
    it('includes run-picker select in dashboard HTML', async () => {
      const app = makeApp();
      const res = await app.request('/');
      const html = await res.text();
      expect(html).toContain('run-picker');
      expect(html).toContain('/api/runs');
    });

    it('embeds INITIAL_SOURCE when sourceFile is provided', async () => {
      const content = toJsonl(RESULT_A, RESULT_B);
      const results = loadResults(content);
      const app = createApp(results, tempDir, tempDir, '/some/path/results-2026.jsonl', noStudio);
      const res = await app.request('/');
      const html = await res.text();
      expect(html).toContain('INITIAL_SOURCE');
      expect(html).toContain('results-2026.jsonl');
    });

    it('sets INITIAL_SOURCE to null when no sourceFile', async () => {
      const app = createApp([], tempDir, undefined, undefined, noStudio);
      const res = await app.request('/');
      const html = await res.text();
      expect(html).toContain('INITIAL_SOURCE = null');
    });
  });
});
