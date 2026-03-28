/**
 * `agentv results serve` — starts a local HTTP server that renders an
 * interactive HTML dashboard for reviewing evaluation results.
 *
 * Features:
 *   - Overview tab: stat cards, targets table, score histogram
 *   - Test Cases tab: filterable/sortable table with expandable detail panels
 *   - Feedback UI: textarea + save button per test, persisted to feedback.json
 *   - Feedback API: GET/POST /api/feedback for reading/writing reviews
 *   - Result picker: dropdown to switch between available result files
 *   - Empty state: starts successfully with no results, shows guidance
 *   - Auto-refresh: polls for new result files every 5 seconds
 *
 * The server uses Hono for routing and @hono/node-server to listen.
 *
 * API endpoints:
 *   - GET /           — dashboard HTML (renders empty state if no results)
 *   - GET /api/runs   — list available result files with metadata
 *   - GET /api/runs/:filename — load results from a specific run file
 *   - GET /api/feedback  — read feedback reviews
 *   - POST /api/feedback — write feedback reviews
 *
 * Exported functions (for testing):
 *   - resolveSourceFile(source, cwd) — resolves JSONL path
 *   - loadResults(content) — parses JSONL into EvaluationResult[]
 *   - createApp(results, cwd) — Hono app factory
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, number, option, optional, positional, string } from 'cmd-ts';

import { DEFAULT_CATEGORY, type EvaluationResult } from '@agentv/core';
import { Hono } from 'hono';

import { parseJsonlResults } from '../eval/artifact-writer.js';
import { loadRunCache, resolveRunCacheFile } from '../eval/run-cache.js';
import { listResultFiles } from '../trace/utils.js';
import {
  loadLightweightResults,
  loadManifestResults,
  parseResultManifest,
  resolveResultSourcePath,
} from './manifest.js';
import { patchTestIds } from './shared.js';

// ── Source resolution ────────────────────────────────────────────────────

/**
 * Resolve the JSONL result file path from an explicit source, run cache,
 * or directory scan. Throws if no file can be found.
 */
export async function resolveSourceFile(source: string | undefined, cwd: string): Promise<string> {
  if (source) {
    const resolved = resolveResultSourcePath(source, cwd);
    if (!existsSync(resolved)) {
      throw new Error(`Source file not found: ${resolved}`);
    }
    return resolved;
  }

  // Prefer cache pointer, fall back to directory scan
  const cache = await loadRunCache(cwd);
  const cachedFile = cache ? resolveRunCacheFile(cache) : '';
  if (cachedFile && existsSync(cachedFile)) {
    return cachedFile;
  }

  const metas = listResultFiles(cwd, 10);
  if (metas.length === 0) {
    throw new Error(
      'No result files found in .agentv/results/\nRun an evaluation first: agentv eval <eval-file>',
    );
  }
  if (metas.length > 1) {
    console.log('Available result files:');
    for (const m of metas) {
      console.log(`  ${m.path}`);
    }
    console.log(`\nServing most recent: ${metas[0].path}\n`);
  }
  return metas[0].path;
}

// ── JSONL parsing ────────────────────────────────────────────────────────

/**
 * Parse JSONL content into EvaluationResult[], with backward-compat
 * patching of eval_id → testId.
 */
export function loadResults(content: string): EvaluationResult[] {
  const results = parseJsonlResults(content);
  if (results.length === 0) {
    throw new Error('No valid results found in JSONL content');
  }

  return results.map((r) => {
    if (!r.testId && (r as unknown as Record<string, unknown>).evalId) {
      return { ...r, testId: String((r as unknown as Record<string, unknown>).evalId) };
    }
    return r;
  });
}

// ── Feedback persistence ─────────────────────────────────────────────────

interface FeedbackReview {
  test_id: string;
  comment: string;
  updated_at: string;
}

interface FeedbackData {
  reviews: FeedbackReview[];
}

function feedbackPath(resultDir: string): string {
  return path.join(resultDir, 'feedback.json');
}

function readFeedback(cwd: string): FeedbackData {
  const fp = feedbackPath(cwd);
  if (!existsSync(fp)) {
    return { reviews: [] };
  }
  try {
    return JSON.parse(readFileSync(fp, 'utf8')) as FeedbackData;
  } catch (err) {
    console.error(`Warning: could not parse ${fp}, starting fresh: ${(err as Error).message}`);
    return { reviews: [] };
  }
}

function writeFeedback(cwd: string, data: FeedbackData): void {
  writeFileSync(feedbackPath(cwd), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// ── Hono app factory ─────────────────────────────────────────────────────

/**
 * Create a Hono app with dashboard, result picker, and feedback API routes.
 * Accepts an empty results array for the empty-state dashboard.
 */
export function createApp(
  results: EvaluationResult[],
  resultDir: string,
  cwd?: string,
  sourceFile?: string,
  options?: { studioDir?: string | false },
): Hono {
  const searchDir = cwd ?? resultDir;
  const app = new Hono();

  // Dashboard HTML — serve Studio SPA if available, otherwise inline HTML.
  // Pass studioDir: false to disable SPA serving (used in tests).
  const studioDistPath =
    options?.studioDir === false ? undefined : (options?.studioDir ?? resolveStudioDistDir());
  app.get('/', (c) => {
    if (studioDistPath) {
      const indexPath = path.join(studioDistPath, 'index.html');
      if (existsSync(indexPath)) {
        return c.html(readFileSync(indexPath, 'utf8'));
      }
    }
    return c.html(generateServeHtml(results, sourceFile));
  });

  // List available result files (for the result picker)
  app.get('/api/runs', (c) => {
    const metas = listResultFiles(searchDir);
    return c.json({
      runs: metas.map((m) => {
        // Enrich with target/experiment from lightweight records
        let target: string | undefined;
        let experiment: string | undefined;
        try {
          const records = loadLightweightResults(m.path);
          if (records.length > 0) {
            target = records[0].target;
            experiment = records[0].experiment;
          }
        } catch {
          // ignore enrichment errors
        }
        return {
          filename: m.filename,
          path: m.path,
          timestamp: m.timestamp,
          test_count: m.testCount,
          pass_rate: m.passRate,
          avg_score: m.avgScore,
          size_bytes: m.sizeBytes,
          ...(target && { target }),
          ...(experiment && { experiment }),
        };
      }),
    });
  });

  // Load results from a specific run file.
  // Security: we look up the filename against the enumerated file list rather than
  // constructing a path from user input, preventing path traversal.
  app.get('/api/runs/:filename', (c) => {
    const filename = c.req.param('filename');
    const metas = listResultFiles(searchDir);
    const meta = metas.find((m) => m.filename === filename);
    if (!meta) {
      return c.json({ error: 'Run not found' }, 404);
    }
    try {
      const loaded = patchTestIds(loadManifestResults(meta.path));
      const lightResults = stripHeavyFields(loaded);
      return c.json({ results: lightResults, source: meta.filename });
    } catch (err) {
      return c.json({ error: 'Failed to load run' }, 500);
    }
  });

  // Read feedback
  app.get('/api/feedback', (c) => {
    const data = readFeedback(resultDir);
    return c.json(data);
  });

  // Write feedback
  app.post('/api/feedback', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid payload' }, 400);
    }

    const payload = body as Record<string, unknown>;
    if (!Array.isArray(payload.reviews)) {
      return c.json({ error: 'Missing reviews array' }, 400);
    }

    const incoming = payload.reviews as Record<string, unknown>[];
    for (const review of incoming) {
      if (typeof review.test_id !== 'string' || typeof review.comment !== 'string') {
        return c.json({ error: 'Each review must have test_id and comment strings' }, 400);
      }
    }

    const existing = readFeedback(resultDir);
    const now = new Date().toISOString();

    for (const review of incoming) {
      const newReview: FeedbackReview = {
        test_id: review.test_id as string,
        comment: review.comment as string,
        updated_at: now,
      };

      const idx = existing.reviews.findIndex((r) => r.test_id === newReview.test_id);
      if (idx >= 0) {
        existing.reviews[idx] = newReview;
      } else {
        existing.reviews.push(newReview);
      }
    }

    writeFeedback(resultDir, existing);
    return c.json(existing);
  });

  // ── New Studio API endpoints ──────────────────────────────────────────

  // Datasets for a specific run (grouped by dataset or target)
  app.get('/api/runs/:filename/datasets', (c) => {
    const filename = c.req.param('filename');
    const metas = listResultFiles(searchDir);
    const meta = metas.find((m) => m.filename === filename);
    if (!meta) {
      return c.json({ error: 'Run not found' }, 404);
    }
    try {
      const loaded = patchTestIds(loadManifestResults(meta.path));
      const datasetMap = new Map<string, { total: number; passed: number; scoreSum: number }>();
      for (const r of loaded) {
        const ds = r.dataset ?? r.target ?? 'default';
        const entry = datasetMap.get(ds) ?? { total: 0, passed: 0, scoreSum: 0 };
        entry.total++;
        if (r.score >= 1) entry.passed++;
        entry.scoreSum += r.score;
        datasetMap.set(ds, entry);
      }
      const datasets = [...datasetMap.entries()].map(([name, entry]) => ({
        name,
        total: entry.total,
        passed: entry.passed,
        failed: entry.total - entry.passed,
        avg_score: entry.total > 0 ? entry.scoreSum / entry.total : 0,
      }));
      return c.json({ datasets });
    } catch {
      return c.json({ error: 'Failed to load datasets' }, 500);
    }
  });

  // Category summaries for a run
  app.get('/api/runs/:filename/categories', (c) => {
    const filename = c.req.param('filename');
    const metas = listResultFiles(searchDir);
    const meta = metas.find((m) => m.filename === filename);
    if (!meta) {
      return c.json({ error: 'Run not found' }, 404);
    }
    try {
      const loaded = patchTestIds(loadManifestResults(meta.path));
      const categoryMap = new Map<
        string,
        { total: number; passed: number; scoreSum: number; datasets: Set<string> }
      >();
      for (const r of loaded) {
        const cat = r.category ?? DEFAULT_CATEGORY;
        const entry = categoryMap.get(cat) ?? {
          total: 0,
          passed: 0,
          scoreSum: 0,
          datasets: new Set<string>(),
        };
        entry.total++;
        if (r.score >= 1) entry.passed++;
        entry.scoreSum += r.score;
        entry.datasets.add(r.dataset ?? r.target ?? 'default');
        categoryMap.set(cat, entry);
      }
      const categories = [...categoryMap.entries()].map(([name, entry]) => ({
        name,
        total: entry.total,
        passed: entry.passed,
        failed: entry.total - entry.passed,
        avg_score: entry.total > 0 ? entry.scoreSum / entry.total : 0,
        dataset_count: entry.datasets.size,
      }));
      return c.json({ categories });
    } catch {
      return c.json({ error: 'Failed to load categories' }, 500);
    }
  });

  // Datasets within a category for a run
  app.get('/api/runs/:filename/categories/:category/datasets', (c) => {
    const filename = c.req.param('filename');
    const category = decodeURIComponent(c.req.param('category'));
    const metas = listResultFiles(searchDir);
    const meta = metas.find((m) => m.filename === filename);
    if (!meta) {
      return c.json({ error: 'Run not found' }, 404);
    }
    try {
      const loaded = patchTestIds(loadManifestResults(meta.path));
      const filtered = loaded.filter((r) => (r.category ?? DEFAULT_CATEGORY) === category);
      const datasetMap = new Map<string, { total: number; passed: number; scoreSum: number }>();
      for (const r of filtered) {
        const ds = r.dataset ?? r.target ?? 'default';
        const entry = datasetMap.get(ds) ?? { total: 0, passed: 0, scoreSum: 0 };
        entry.total++;
        if (r.score >= 1) entry.passed++;
        entry.scoreSum += r.score;
        datasetMap.set(ds, entry);
      }
      const datasets = [...datasetMap.entries()].map(([name, entry]) => ({
        name,
        total: entry.total,
        passed: entry.passed,
        failed: entry.total - entry.passed,
        avg_score: entry.total > 0 ? entry.scoreSum / entry.total : 0,
      }));
      return c.json({ datasets });
    } catch {
      return c.json({ error: 'Failed to load datasets' }, 500);
    }
  });

  // Full eval detail with hydrated artifacts
  app.get('/api/runs/:filename/evals/:evalId', (c) => {
    const filename = c.req.param('filename');
    const evalId = c.req.param('evalId');
    const metas = listResultFiles(searchDir);
    const meta = metas.find((m) => m.filename === filename);
    if (!meta) {
      return c.json({ error: 'Run not found' }, 404);
    }
    try {
      const loaded = patchTestIds(loadManifestResults(meta.path));
      const result = loaded.find((r) => r.testId === evalId);
      if (!result) {
        return c.json({ error: 'Eval not found' }, 404);
      }
      return c.json({ eval: result });
    } catch {
      return c.json({ error: 'Failed to load eval' }, 500);
    }
  });

  // Aggregated index across all runs (for leaderboard)
  app.get('/api/index', (c) => {
    const metas = listResultFiles(searchDir);
    const entries = metas.map((m) => {
      let totalCostUsd = 0;
      try {
        const loaded = patchTestIds(loadManifestResults(m.path));
        totalCostUsd = loaded.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      } catch {
        // ignore load errors for aggregate
      }
      return {
        run_filename: m.filename,
        test_count: m.testCount,
        pass_rate: m.passRate,
        avg_score: m.avgScore,
        total_cost_usd: totalCostUsd,
        timestamp: m.timestamp,
      };
    });
    return c.json({ entries });
  });

  // ── File tree for eval artifacts ────────────────────────────────────────

  interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'dir';
    children?: FileNode[];
  }

  function buildFileTree(dirPath: string, relativeTo: string): FileNode[] {
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      return [];
    }
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.relative(relativeTo, fullPath);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: relPath,
            type: 'dir' as const,
            children: buildFileTree(fullPath, relativeTo),
          };
        }
        return { name: entry.name, path: relPath, type: 'file' as const };
      });
  }

  function inferLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.json': 'json',
      '.jsonl': 'json',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.md': 'markdown',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.log': 'plaintext',
      '.txt': 'plaintext',
      '.py': 'python',
      '.sh': 'shell',
      '.bash': 'shell',
      '.css': 'css',
      '.html': 'html',
      '.xml': 'xml',
      '.svg': 'xml',
      '.toml': 'toml',
      '.diff': 'diff',
      '.patch': 'diff',
    };
    return langMap[ext] ?? 'plaintext';
  }

  // File tree for a specific eval's artifact directory
  app.get('/api/runs/:filename/evals/:evalId/files', (c) => {
    const filename = c.req.param('filename');
    const evalId = c.req.param('evalId');
    const metas = listResultFiles(searchDir);
    const meta = metas.find((m) => m.filename === filename);
    if (!meta) {
      return c.json({ error: 'Run not found' }, 404);
    }
    try {
      const content = readFileSync(meta.path, 'utf8');
      const records = parseResultManifest(content);
      const record = records.find((r) => (r.test_id ?? r.eval_id) === evalId);
      if (!record) {
        return c.json({ error: 'Eval not found' }, 404);
      }

      const baseDir = path.dirname(meta.path);

      // Derive the eval's artifact subdirectory from known paths
      const knownPaths = [
        record.grading_path,
        record.timing_path,
        record.input_path,
        record.output_path,
        record.response_path,
      ].filter((p): p is string => !!p);

      if (knownPaths.length === 0) {
        return c.json({ files: [] });
      }

      // Find the common parent directory of all artifact paths
      const artifactDirs = knownPaths.map((p) => path.dirname(p));
      let commonDir = artifactDirs[0];
      for (const dir of artifactDirs) {
        while (!dir.startsWith(commonDir)) {
          commonDir = path.dirname(commonDir);
        }
      }

      const artifactAbsDir = path.join(baseDir, commonDir);
      const files = buildFileTree(artifactAbsDir, baseDir);
      return c.json({ files });
    } catch {
      return c.json({ error: 'Failed to load file tree' }, 500);
    }
  });

  // File content for a specific artifact file
  app.get('/api/runs/:filename/evals/:evalId/files/*', (c) => {
    const filename = c.req.param('filename');
    const evalId = c.req.param('evalId');
    const metas = listResultFiles(searchDir);
    const meta = metas.find((m) => m.filename === filename);
    if (!meta) {
      return c.json({ error: 'Run not found' }, 404);
    }

    // Extract the file path from the wildcard portion
    const requestPath = c.req.path;
    const prefix = `/api/runs/${filename}/evals/${evalId}/files/`;
    const filePath = requestPath.slice(prefix.length);

    if (!filePath) {
      return c.json({ error: 'No file path specified' }, 400);
    }

    const baseDir = path.dirname(meta.path);
    const absolutePath = path.resolve(baseDir, filePath);

    // Security: prevent path traversal — resolved path must be inside baseDir
    if (
      !absolutePath.startsWith(path.resolve(baseDir) + path.sep) &&
      absolutePath !== path.resolve(baseDir)
    ) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }

    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      return c.json({ error: 'File not found' }, 404);
    }

    try {
      const fileContent = readFileSync(absolutePath, 'utf8');
      const language = inferLanguage(absolutePath);
      return c.json({ content: fileContent, language });
    } catch {
      return c.json({ error: 'Failed to read file' }, 500);
    }
  });

  // ── Aggregate endpoints ─────────────────────────────────────────────────

  // Experiments aggregate (group all runs by experiment)
  app.get('/api/experiments', (c) => {
    const metas = listResultFiles(searchDir);
    const experimentMap = new Map<
      string,
      {
        targets: Set<string>;
        runFilenames: Set<string>;
        evalCount: number;
        passedCount: number;
        lastTimestamp: string;
      }
    >();

    for (const m of metas) {
      try {
        const records = loadLightweightResults(m.path);
        for (const r of records) {
          const experiment = r.experiment ?? 'default';
          const entry = experimentMap.get(experiment) ?? {
            targets: new Set<string>(),
            runFilenames: new Set<string>(),
            evalCount: 0,
            passedCount: 0,
            lastTimestamp: '',
          };
          entry.runFilenames.add(m.filename);
          if (r.target) entry.targets.add(r.target);
          entry.evalCount++;
          if (r.score >= 1) entry.passedCount++;
          if (r.timestamp && r.timestamp > entry.lastTimestamp) {
            entry.lastTimestamp = r.timestamp;
          }
          experimentMap.set(experiment, entry);
        }
      } catch {
        // skip runs that fail to load
      }
    }

    const experiments = [...experimentMap.entries()].map(([name, entry]) => ({
      name,
      run_count: entry.runFilenames.size,
      target_count: entry.targets.size,
      eval_count: entry.evalCount,
      passed_count: entry.passedCount,
      pass_rate: entry.evalCount > 0 ? entry.passedCount / entry.evalCount : 0,
      last_run: entry.lastTimestamp || null,
    }));

    return c.json({ experiments });
  });

  // Targets aggregate (group all runs by target)
  app.get('/api/targets', (c) => {
    const metas = listResultFiles(searchDir);
    const targetMap = new Map<
      string,
      {
        experiments: Set<string>;
        runFilenames: Set<string>;
        evalCount: number;
        passedCount: number;
      }
    >();

    for (const m of metas) {
      try {
        const records = loadLightweightResults(m.path);
        for (const r of records) {
          const target = r.target ?? 'default';
          const entry = targetMap.get(target) ?? {
            experiments: new Set<string>(),
            runFilenames: new Set<string>(),
            evalCount: 0,
            passedCount: 0,
          };
          entry.runFilenames.add(m.filename);
          if (r.experiment) entry.experiments.add(r.experiment);
          entry.evalCount++;
          if (r.score >= 1) entry.passedCount++;
          targetMap.set(target, entry);
        }
      } catch {
        // skip runs that fail to load
      }
    }

    const targets = [...targetMap.entries()].map(([name, entry]) => ({
      name,
      run_count: entry.runFilenames.size,
      experiment_count: entry.experiments.size,
      eval_count: entry.evalCount,
      passed_count: entry.passedCount,
      pass_rate: entry.evalCount > 0 ? entry.passedCount / entry.evalCount : 0,
    }));

    return c.json({ targets });
  });

  // ── Static file serving for Studio SPA ────────────────────────────────

  if (studioDistPath) {
    // Serve static assets from studio dist
    app.get('/assets/*', (c) => {
      const assetPath = c.req.path;
      const filePath = path.join(studioDistPath, assetPath);
      if (!existsSync(filePath)) {
        return c.notFound();
      }
      const content = readFileSync(filePath);
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
      };
      const contentType = mimeTypes[ext] ?? 'application/octet-stream';
      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    });

    // SPA fallback: serve index.html for any non-API route that isn't matched
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/')) {
        return c.json({ error: 'Not found' }, 404);
      }
      const indexPath = path.join(studioDistPath, 'index.html');
      if (existsSync(indexPath)) {
        return c.html(readFileSync(indexPath, 'utf8'));
      }
      return c.notFound();
    });
  }

  return app;
}

/**
 * Resolve the path to the studio dist directory.
 *
 * Searches several candidate locations covering:
 *   - Running from TypeScript source (`bun apps/cli/src/cli.ts`)
 *   - Running from built dist (`bun apps/cli/dist/cli.js`)
 *   - Published npm package (studio bundled inside `dist/studio/`)
 */
function resolveStudioDistDir(): string | undefined {
  const currentDir =
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // From src/commands/results/ → sibling apps/studio/dist
    path.resolve(currentDir, '../../../../studio/dist'),
    // From dist/ → sibling apps/studio/dist (monorepo dev)
    path.resolve(currentDir, '../../studio/dist'),
    // Bundled inside CLI dist (published package)
    path.resolve(currentDir, '../studio'),
    // From dist/ in monorepo root context
    path.resolve(currentDir, '../../../apps/studio/dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Strip heavy fields (requests, trace) from results for JSON API responses.
 * Mirrors the logic used in generateServeHtml for the embedded DATA.
 */
function stripHeavyFields(results: readonly EvaluationResult[]) {
  return results.map((r) => {
    const { requests, trace, ...rest } = r as EvaluationResult & Record<string, unknown>;
    const toolCalls =
      trace?.toolCalls && Object.keys(trace.toolCalls).length > 0 ? trace.toolCalls : undefined;
    const graderDurationMs = (r.scores ?? []).reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    return {
      ...rest,
      ...(toolCalls && { _toolCalls: toolCalls }),
      ...(graderDurationMs > 0 && { _graderDurationMs: graderDurationMs }),
    };
  });
}

// ── HTML generation ──────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateServeHtml(results: readonly EvaluationResult[], sourceFile?: string): string {
  const lightResults = stripHeavyFields(results);
  // Escape for safe embedding in <script>: prevent </script> breakout,
  // HTML comment injection, and Unicode line terminators.
  const dataJson = JSON.stringify(lightResults)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AgentV Results Review</title>
    <style>
${SERVE_STYLES}
    </style>
</head>
<body>
    <header class="header">
        <div class="header-left">
            <h1 class="header-title">AgentV</h1>
            <span class="header-subtitle">Results Review</span>
        </div>
        <div class="header-center">
            <select id="run-picker" class="run-picker" title="Switch result file">
                <option value="">Loading runs...</option>
            </select>
        </div>
        <div class="header-right">
            <span class="timestamp">${escapeHtml(new Date().toISOString())}</span>
        </div>
    </header>
    <nav class="tabs" id="tabs">
        <button class="tab active" data-tab="overview">Overview</button>
        <button class="tab" data-tab="tests">Test Cases</button>
    </nav>
    <main id="app"></main>
    <script>
    var DATA = ${dataJson};
    var INITIAL_SOURCE = ${sourceFile ? JSON.stringify(path.basename(sourceFile)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') : 'null'};
${SERVE_SCRIPT}
    </script>
</body>
</html>`;
}

// ── Embedded CSS ─────────────────────────────────────────────────────────

const SERVE_STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#f6f8fa;--surface:#fff;--border:#d0d7de;--border-light:#e8ebee;
  --text:#1f2328;--text-muted:#656d76;
  --primary:#0969da;--primary-bg:#ddf4ff;
  --success:#1a7f37;--success-bg:#dafbe1;
  --danger:#cf222e;--danger-bg:#ffebe9;
  --warning:#9a6700;--warning-bg:#fff8c5;
  --radius:6px;
  --shadow:0 1px 3px rgba(31,35,40,.04),0 1px 2px rgba(31,35,40,.06);
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.5;font-size:14px}

/* Header */
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;justify-content:space-between}
.header-left{display:flex;align-items:baseline;gap:12px}
.header-title{font-size:18px;font-weight:600}
.header-subtitle{font-size:14px;color:var(--text-muted)}
.header-center{flex:1;display:flex;justify-content:center;padding:0 16px}
.run-picker{padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;background:var(--surface);color:var(--text);font-family:var(--font);max-width:400px;width:100%;cursor:pointer}
.run-picker:hover{border-color:var(--primary)}
.run-picker:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-bg)}
.timestamp{font-size:12px;color:var(--text-muted);font-family:var(--mono)}

/* Tabs */
.tabs{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;display:flex}
.tab{background:none;border:none;padding:10px 16px;font-size:14px;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;font-family:var(--font);transition:color .15s,border-color .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--text);font-weight:600;border-bottom-color:var(--primary)}

#app{max-width:1280px;margin:0 auto;padding:24px}

/* Stat cards */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center;box-shadow:var(--shadow)}
.stat-card.pass .stat-value{color:var(--success)}
.stat-card.fail .stat-value{color:var(--danger)}
.stat-card.error .stat-value{color:var(--danger)}
.stat-card.warn .stat-value{color:var(--warning)}
.stat-card.total .stat-value{color:var(--primary)}
.stat-value{font-size:28px;font-weight:700;line-height:1.2}
.stat-label{font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:4px}

/* Sections */
.section{margin-bottom:24px}
.section-title{font-size:16px;font-weight:600;margin-bottom:12px}

/* Tables */
.table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}
.data-table{width:100%;border-collapse:collapse;font-size:13px}
.data-table th{background:var(--bg);border-bottom:1px solid var(--border);padding:8px 12px;text-align:left;font-weight:600;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;white-space:nowrap}
.data-table th.sortable{cursor:pointer;user-select:none}
.data-table th.sortable:hover{color:var(--text)}
.data-table td{padding:8px 12px;border-bottom:1px solid var(--border-light);vertical-align:middle}
.data-table tbody tr:last-child td{border-bottom:none}

/* Status icons */
.status-icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:12px;font-weight:700}
.status-icon.pass{background:var(--success-bg);color:var(--success)}
.status-icon.fail{background:var(--danger-bg);color:var(--danger)}
.status-icon.error{background:var(--warning-bg);color:var(--warning)}

/* Score colors */
.score-high{color:var(--success);font-weight:600}
.score-mid{color:var(--warning);font-weight:600}
.score-low{color:var(--danger);font-weight:600}

/* Pass-rate bar */
.bar-bg{width:100px;height:8px;background:var(--border-light);border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;transition:width .3s}
.bar-fill.score-high{background:var(--success)}
.bar-fill.score-mid{background:var(--warning)}
.bar-fill.score-low{background:var(--danger)}

/* Histogram */
.histogram{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)}
.hist-row{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.hist-row:last-child{margin-bottom:0}
.hist-label{width:60px;font-size:12px;color:var(--text-muted);text-align:right;flex-shrink:0}
.hist-bar-bg{flex:1;height:20px;background:var(--border-light);border-radius:3px;overflow:hidden}
.hist-bar{height:100%;border-radius:3px;transition:width .3s}
.hist-count{width:30px;font-size:12px;color:var(--text-muted);text-align:right;flex-shrink:0}

/* Filters */
.filter-bar{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
.filter-select,.filter-search{padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;background:var(--surface);color:var(--text);font-family:var(--font)}
.filter-search{flex:1;min-width:200px}
.filter-count{font-size:12px;color:var(--text-muted);margin-left:auto}

/* Test rows */
.test-row{cursor:pointer;transition:background .1s}
.test-row:hover{background:var(--bg)!important}
.test-row.expanded{background:var(--primary-bg)!important}
.expand-col{width:32px;text-align:center}
.expand-icon{color:var(--text-muted);font-size:12px}
.fw-medium{font-weight:500}
.text-pass{color:var(--success)}.text-fail{color:var(--danger)}.text-error{color:var(--warning)}

/* Detail panel */
.detail-row td{padding:0!important;background:var(--bg)!important}
.detail-panel{padding:16px 24px}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.detail-block h4{font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px}
.detail-pre{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-family:var(--mono);font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;line-height:1.6}
.detail-panel h4{font-size:13px;font-weight:600;margin:16px 0 8px}
.eval-table{width:100%;border-collapse:collapse;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:12px}
.eval-table th{background:var(--bg);padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)}
.eval-table td{padding:8px 10px;border-bottom:1px solid var(--border-light)}
.reasoning-cell{max-width:500px;font-size:12px;color:var(--text-muted)}
.expect-list{list-style:none;padding:0;margin-bottom:12px}
.expect-list li{padding:4px 8px 4px 24px;position:relative;font-size:13px}
.expect-list.pass li::before{content:"\\2713";position:absolute;left:4px;color:var(--success);font-weight:700}
.expect-list.fail li::before{content:"\\2717";position:absolute;left:4px;color:var(--danger);font-weight:700}
.error-box{background:var(--danger-bg);border:1px solid var(--danger);border-radius:var(--radius);padding:12px;margin-bottom:12px}
.error-box h4{color:var(--danger);margin:0 0 6px}
.error-box pre{font-family:var(--mono);font-size:12px;white-space:pre-wrap;word-break:break-word}
.detail-meta{font-size:12px;color:var(--text-muted);margin-top:12px;padding-top:12px;border-top:1px solid var(--border-light)}
.tool-calls{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.tool-tag{display:inline-block;padding:2px 10px;font-size:12px;font-family:var(--mono);background:var(--primary-bg);color:var(--primary);border:1px solid var(--border);border-radius:12px}
.empty-state{text-align:center;padding:48px 24px;color:var(--text-muted)}
.empty-state h3{font-size:16px;margin-bottom:8px;color:var(--text)}
.welcome-state{text-align:center;padding:80px 24px;color:var(--text-muted)}
.welcome-state h2{font-size:24px;margin-bottom:12px;color:var(--text);font-weight:600}
.welcome-state p{font-size:15px;margin-bottom:8px;max-width:500px;margin-left:auto;margin-right:auto}
.welcome-state code{font-family:var(--mono);background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:2px 6px;font-size:13px}
.welcome-state .hint{margin-top:24px;font-size:13px;color:var(--text-muted)}

/* Feedback */
.feedback-section{margin-top:16px;padding-top:16px;border-top:1px solid var(--border-light)}
.feedback-input{width:100%;min-height:80px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);font-family:var(--font);font-size:13px;resize:vertical;background:var(--surface);color:var(--text)}
.feedback-input:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-bg)}
.feedback-submit{margin-top:8px;padding:6px 16px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius);font-size:13px;cursor:pointer;font-family:var(--font)}
.feedback-submit:hover{opacity:.9}
.feedback-submit:disabled{opacity:.5;cursor:default}
.feedback-status{margin-left:8px;font-size:12px;color:var(--success)}
`;

// ── Embedded JavaScript ──────────────────────────────────────────────────

const SERVE_SCRIPT = `
(function(){
  /* ---- helpers ---- */
  function esc(s){
    if(s==null)return"";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function getStatus(r){
    if(r.executionStatus==="execution_error")return"error";
    if(r.executionStatus==="quality_failure")return"fail";
    if(r.executionStatus==="ok")return"pass";
    if(r.error)return"error";
    return r.score>=0.5?"pass":"fail";
  }
  function sIcon(s){
    if(s==="pass")return'<span class="status-icon pass">\\u2713</span>';
    if(s==="fail")return'<span class="status-icon fail">\\u2717</span>';
    return'<span class="status-icon error">!</span>';
  }
  function fmtDur(ms){
    if(ms==null)return"\\u2014";
    if(ms<1000)return ms+"ms";
    if(ms<60000)return(ms/1000).toFixed(1)+"s";
    return Math.floor(ms/60000)+"m "+Math.round((ms%60000)/1000)+"s";
  }
  function fmtTok(n){
    if(n==null)return"\\u2014";
    if(n>=1e6)return(n/1e6).toFixed(1)+"M";
    if(n>=1e3)return(n/1e3).toFixed(1)+"K";
    return String(n);
  }
  function fmtCost(u){if(u==null)return"\\u2014";if(u<0.01)return"<$0.01";return"$"+u.toFixed(2);}
  function fmtPct(v){if(v==null)return"\\u2014";return(v*100).toFixed(1)+"%";}
  function sCls(v){if(v==null)return"";if(v>=0.9)return"score-high";if(v>=0.5)return"score-mid";return"score-low";}

  /* ---- feedback state ---- */
  var feedbackCache={};

  function loadFeedback(){
    fetch("/api/feedback").then(function(r){return r.json();}).then(function(d){
      if(d&&d.reviews){
        for(var i=0;i<d.reviews.length;i++){
          feedbackCache[d.reviews[i].test_id]=d.reviews[i].comment;
        }
        populateFeedbackTextareas();
      }
    }).catch(function(){});
  }

  function populateFeedbackTextareas(){
    var areas=document.querySelectorAll(".feedback-input");
    for(var i=0;i<areas.length;i++){
      var tid=areas[i].getAttribute("data-test-id");
      if(tid&&feedbackCache[tid]!=null){
        areas[i].value=feedbackCache[tid];
      }
    }
  }

  function saveFeedback(testId,comment,statusEl,btn){
    btn.disabled=true;
    statusEl.textContent="Saving...";
    statusEl.style.color="var(--text-muted)";
    fetch("/api/feedback",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({reviews:[{test_id:testId,comment:comment}]})
    }).then(function(r){return r.json();}).then(function(){
      feedbackCache[testId]=comment;
      statusEl.textContent="Saved";
      statusEl.style.color="var(--success)";
      btn.disabled=false;
      setTimeout(function(){statusEl.textContent="";},2000);
    }).catch(function(){
      statusEl.textContent="Error saving";
      statusEl.style.color="var(--danger)";
      btn.disabled=false;
    });
  }

  /* ---- compute stats ---- */
  function computeStats(d){
    var t=d.length,p=0,f=0,e=0,dur=0,ti=0,to=0,cost=0,sc=[],tc=0;
    for(var i=0;i<d.length;i++){
      var r=d[i],s=getStatus(r);
      if(s==="pass")p++;else if(s==="fail")f++;else e++;
      if(r.durationMs)dur+=r.durationMs;
      if(r.tokenUsage){ti+=(r.tokenUsage.input||0);to+=(r.tokenUsage.output||0);}
      if(r.costUsd)cost+=r.costUsd;
      if(s!=="error")sc.push(r.score);
      if(r._toolCalls){for(var k in r._toolCalls)tc+=r._toolCalls[k];}
    }
    var g=t-e;
    return{total:t,passed:p,failed:f,errors:e,passRate:g>0?p/g:0,dur:dur,tokens:ti+to,inTok:ti,outTok:to,cost:cost,scores:sc,toolCalls:tc};
  }
  function computeTargets(d){
    var m={};
    for(var i=0;i<d.length;i++){
      var r=d[i],tgt=r.target||"unknown";
      if(!m[tgt])m[tgt]={target:tgt,results:[],p:0,f:0,e:0,ts:0,sc:0,dur:0,tok:0,cost:0};
      var o=m[tgt];o.results.push(r);
      var s=getStatus(r);
      if(s==="pass")o.p++;else if(s==="fail")o.f++;else o.e++;
      if(s!=="error"){o.ts+=r.score;o.sc++;}
      if(r.durationMs)o.dur+=r.durationMs;
      if(r.tokenUsage)o.tok+=(r.tokenUsage.input||0)+(r.tokenUsage.output||0);
      if(r.costUsd)o.cost+=r.costUsd;
    }
    var a=[];for(var k in m)a.push(m[k]);return a;
  }
  function getEvalNames(){
    var n={};
    for(var i=0;i<DATA.length;i++){
      var sc=DATA[i].scores;
      if(sc)for(var j=0;j<sc.length;j++)n[sc[j].name]=true;
    }
    return Object.keys(n);
  }
  function getEvalScore(r,name){
    if(!r.scores)return null;
    for(var i=0;i<r.scores.length;i++)if(r.scores[i].name===name)return r.scores[i].score;
    return null;
  }

  var stats=computeStats(DATA);
  var tgtStats=computeTargets(DATA);
  var tgtNames=tgtStats.map(function(t){return t.target;});

  /* ---- state ---- */
  var state={tab:"overview",filter:{status:"all",target:"all",search:""},sort:{col:"testId",dir:"asc"},expanded:{}};

  /* ---- DOM refs ---- */
  var app=document.getElementById("app");
  var tabBtns=document.querySelectorAll(".tab");

  /* ---- tabs ---- */
  function setTab(t){
    state.tab=t;
    for(var i=0;i<tabBtns.length;i++)tabBtns[i].classList.toggle("active",tabBtns[i].getAttribute("data-tab")===t);
    render();
  }
  for(var i=0;i<tabBtns.length;i++){
    tabBtns[i].addEventListener("click",(function(b){return function(){setTab(b.getAttribute("data-tab"));};})(tabBtns[i]));
  }

  /* ---- render ---- */
  function render(){
    if(DATA.length===0){
      app.innerHTML='<div class="welcome-state">'
        +'<h2>No results yet</h2>'
        +'<p>Run an evaluation or mount a results directory to see results here.</p>'
        +'<p><code>agentv eval &lt;eval-file&gt;</code></p>'
        +'<p class="hint">The dashboard will automatically detect new result files.</p>'
        +'</div>';
      return;
    }
    if(state.tab==="overview")renderOverview();else renderTests();
  }

  /* ---- stat card helper ---- */
  function card(label,value,type){
    return'<div class="stat-card '+type+'"><div class="stat-value">'+value+'</div><div class="stat-label">'+label+"</div></div>";
  }

  /* ---- overview ---- */
  function renderOverview(){
    var h='<div class="stats-grid">';
    h+=card("Total Tests",stats.total,"total");
    h+=card("Passed",stats.passed,"pass");
    h+=card("Failed",stats.failed,"fail");
    h+=card("Errors",stats.errors,"error");
    var prCls=stats.passRate>=0.9?"pass":stats.passRate>=0.5?"warn":"fail";
    h+=card("Pass Rate",fmtPct(stats.passRate),prCls);
    h+=card("Duration",fmtDur(stats.dur),"neutral");
    h+=card("Tokens",fmtTok(stats.tokens),"neutral");
    h+=card("Est. Cost",fmtCost(stats.cost),"neutral");
    if(stats.toolCalls>0)h+=card("Tool Calls",fmtTok(stats.toolCalls),"neutral");
    h+="</div>";

    /* targets table */
    if(tgtStats.length>1){
      h+='<div class="section"><h2 class="section-title">Targets</h2><div class="table-wrap"><table class="data-table">';
      h+="<thead><tr><th>Target</th><th>Pass Rate</th><th></th><th>Passed</th><th>Failed</th><th>Errors</th><th>Avg Score</th><th>Duration</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>";
      for(var i=0;i<tgtStats.length;i++){
        var t=tgtStats[i],g=t.p+t.f,pr=g>0?t.p/g:0,avg=t.sc>0?t.ts/t.sc:0;
        h+="<tr><td class=\\"fw-medium\\">"+esc(t.target)+"</td><td>"+fmtPct(pr)+'</td><td><div class="bar-bg"><div class="bar-fill '+sCls(pr)+'" style="width:'+(pr*100)+'%"></div></div></td>';
        h+='<td class="text-pass">'+t.p+'</td><td class="text-fail">'+t.f+'</td><td class="text-error">'+t.e+"</td>";
        h+='<td class="'+sCls(avg)+'">'+fmtPct(avg)+"</td><td>"+fmtDur(t.dur)+"</td><td>"+fmtTok(t.tok)+"</td><td>"+fmtCost(t.cost)+"</td></tr>";
      }
      h+="</tbody></table></div></div>";
    }

    /* histogram */
    if(stats.scores.length>0){
      var bk=[0,0,0,0,0];
      for(var i=0;i<stats.scores.length;i++){var idx=Math.min(Math.floor(stats.scores[i]*5),4);bk[idx]++;}
      var mx=Math.max.apply(null,bk);
      var lb=["0\\u201320%","20\\u201340%","40\\u201360%","60\\u201380%","80\\u2013100%"];
      h+='<div class="section"><h2 class="section-title">Score Distribution</h2><div class="histogram">';
      for(var i=0;i<bk.length;i++){
        var pct=mx>0?(bk[i]/mx*100):0;
        h+='<div class="hist-row"><span class="hist-label">'+lb[i]+'</span><div class="hist-bar-bg"><div class="hist-bar '+(i>=4?"score-high":i>=2?"score-mid":"score-low")+'" style="width:'+pct+'%"></div></div><span class="hist-count">'+bk[i]+"</span></div>";
      }
      h+="</div></div>";
    }
    app.innerHTML=h;
  }

  /* ---- test cases ---- */
  function renderTests(){
    var evalNames=getEvalNames();
    var h='<div class="filter-bar">';
    h+='<select id="flt-status" class="filter-select"><option value="all">All Status</option><option value="pass">Passed</option><option value="fail">Failed</option><option value="error">Errors</option></select>';
    if(tgtNames.length>1){
      h+='<select id="flt-target" class="filter-select"><option value="all">All Targets</option>';
      for(var i=0;i<tgtNames.length;i++)h+='<option value="'+esc(tgtNames[i])+'">'+esc(tgtNames[i])+"</option>";
      h+="</select>";
    }
    h+='<input type="text" id="flt-search" class="filter-search" placeholder="Search tests..." value="'+esc(state.filter.search)+'">';
    h+='<span class="filter-count" id="flt-count"></span></div>';

    h+='<div class="table-wrap"><table class="data-table" id="test-tbl"><thead><tr>';
    h+='<th class="expand-col"></th>';
    h+=sHdr("Status","status");
    h+=sHdr("Test ID","testId");
    if(tgtNames.length>1)h+=sHdr("Target","target");
    h+=sHdr("Score","score");
    for(var i=0;i<evalNames.length;i++)h+="<th>"+esc(evalNames[i])+"</th>";
    h+=sHdr("Duration","durationMs");
    h+=sHdr("Cost","costUsd");
    h+="</tr></thead><tbody id=\\"test-body\\"></tbody></table></div>";
    app.innerHTML=h;

    /* wire events */
    var selS=document.getElementById("flt-status");
    selS.value=state.filter.status;
    selS.addEventListener("change",function(e){state.filter.status=e.target.value;renderRows();});
    var selT=document.getElementById("flt-target");
    if(selT){selT.value=state.filter.target;selT.addEventListener("change",function(e){state.filter.target=e.target.value;renderRows();});}
    document.getElementById("flt-search").addEventListener("input",function(e){state.filter.search=e.target.value;renderRows();});
    var ths=document.querySelectorAll("th[data-sort]");
    for(var i=0;i<ths.length;i++){
      ths[i].addEventListener("click",(function(th){return function(){
        var c=th.getAttribute("data-sort");
        if(state.sort.col===c)state.sort.dir=state.sort.dir==="asc"?"desc":"asc";
        else{state.sort.col=c;state.sort.dir="asc";}
        renderTests();
      };})(ths[i]));
    }
    renderRows();
  }

  function sHdr(label,col){
    var arrow="";
    if(state.sort.col===col)arrow=state.sort.dir==="asc"?" \\u2191":" \\u2193";
    return'<th class="sortable" data-sort="'+col+'">'+label+arrow+"</th>";
  }

  function filtered(){
    var out=[];
    for(var i=0;i<DATA.length;i++){
      var r=DATA[i],s=getStatus(r);
      if(state.filter.status!=="all"&&s!==state.filter.status)continue;
      if(state.filter.target!=="all"&&r.target!==state.filter.target)continue;
      if(state.filter.search&&(r.testId||"").toLowerCase().indexOf(state.filter.search.toLowerCase())===-1)continue;
      out.push(r);
    }
    var col=state.sort.col,dir=state.sort.dir==="asc"?1:-1;
    out.sort(function(a,b){
      var va=col==="status"?getStatus(a):a[col],vb=col==="status"?getStatus(b):b[col];
      if(va==null&&vb==null)return 0;if(va==null)return 1;if(vb==null)return-1;
      if(typeof va==="string")return va.localeCompare(vb)*dir;
      return(va-vb)*dir;
    });
    return out;
  }

  function renderRows(){
    var rows=filtered(),evalNames=getEvalNames();
    var tbody=document.getElementById("test-body");
    var colSpan=5+evalNames.length+(tgtNames.length>1?1:0);
    document.getElementById("flt-count").textContent=rows.length+" of "+DATA.length+" tests";
    var h="";
    for(var i=0;i<rows.length;i++){
      var r=rows[i],s=getStatus(r),key=r.testId+":"+r.target,exp=!!state.expanded[key];
      h+='<tr class="test-row '+s+(exp?" expanded":"")+'" data-key="'+esc(key)+'" data-test-id="'+esc(r.testId)+'">';
      h+='<td class="expand-col"><span class="expand-icon">'+(exp?"\\u25BE":"\\u25B8")+"</span></td>";
      h+="<td>"+sIcon(s)+"</td>";
      h+='<td class="fw-medium">'+esc(r.testId)+"</td>";
      if(tgtNames.length>1)h+="<td>"+esc(r.target)+"</td>";
      h+='<td class="'+sCls(r.score)+'">'+fmtPct(r.score)+"</td>";
      for(var j=0;j<evalNames.length;j++){
        var es=getEvalScore(r,evalNames[j]);
        h+='<td class="'+sCls(es)+'">'+(es!=null?fmtPct(es):"\\u2014")+"</td>";
      }
      h+="<td>"+fmtDur(r.durationMs)+"</td><td>"+fmtCost(r.costUsd)+"</td></tr>";
      if(exp)h+='<tr class="detail-row"><td colspan="'+colSpan+'">'+renderDetail(r)+"</td></tr>";
    }
    if(rows.length===0)h+='<tr><td colspan="'+colSpan+'" class="empty-state">No matching tests</td></tr>';
    tbody.innerHTML=h;

    /* row click */
    var trs=tbody.querySelectorAll(".test-row");
    for(var k=0;k<trs.length;k++){
      trs[k].addEventListener("click",(function(tr){return function(){
        var key=tr.getAttribute("data-key");
        state.expanded[key]=!state.expanded[key];
        renderRows();
      };})(trs[k]));
    }

    /* wire feedback buttons */
    var btns=tbody.querySelectorAll(".feedback-submit");
    for(var k=0;k<btns.length;k++){
      btns[k].addEventListener("click",(function(btn){return function(ev){
        ev.stopPropagation();
        var tid=btn.getAttribute("data-test-id");
        var sec=btn.closest(".feedback-section");
        var ta=sec.querySelector(".feedback-input");
        var st=sec.querySelector(".feedback-status");
        saveFeedback(tid,ta.value,st,btn);
      };})(btns[k]));
    }

    /* prevent textarea clicks from toggling row */
    var tas=tbody.querySelectorAll(".feedback-input");
    for(var k=0;k<tas.length;k++){
      tas[k].addEventListener("click",function(ev){ev.stopPropagation();});
    }

    populateFeedbackTextareas();
  }

  /* ---- detail panel ---- */
  function renderDetail(r){
    var h='<div class="detail-panel">';

    /* input / output */
    h+='<div class="detail-grid">';
    if(r.input!=null){
      h+='<div class="detail-block"><h4>Input</h4><pre class="detail-pre">'+esc(JSON.stringify(r.input,null,2))+"</pre></div>";
    }
    h+='<div class="detail-block"><h4>Output</h4><pre class="detail-pre">'+esc(r.output?JSON.stringify(r.output,null,2):"")+"</pre></div>";
    h+="</div>";

    /* evaluator results */
    if(r.scores&&r.scores.length>0){
      h+="<h4>Evaluator Results</h4>";
      h+='<table class="eval-table"><thead><tr><th>Evaluator</th><th>Score</th><th>Status</th><th>Assertions</th></tr></thead><tbody>';
      for(var i=0;i<r.scores.length;i++){
        var ev=r.scores[i],evS=ev.score>=0.5?"pass":"fail";
        var evAssertions=ev.assertions||[];
        var evSummary=evAssertions.map(function(a){return (a.passed?"\\u2713 ":"\\u2717 ")+a.text;}).join("; ");
        h+="<tr><td class=\\"fw-medium\\">"+esc(ev.name)+'</td><td class="'+sCls(ev.score)+'">'+fmtPct(ev.score)+"</td><td>"+sIcon(evS)+'</td><td class="reasoning-cell">'+esc(evSummary)+"</td></tr>";
      }
      h+="</tbody></table>";
    }

    /* assertions */
    var passedA=r.assertions?r.assertions.filter(function(a){return a.passed;}):[];
    var failedA=r.assertions?r.assertions.filter(function(a){return !a.passed;}):[];
    if(passedA.length>0){
      h+='<h4>Passed Assertions</h4><ul class="expect-list pass">';
      for(var i=0;i<passedA.length;i++)h+="<li>"+esc(passedA[i].text)+(passedA[i].evidence?" <span class=\\"reasoning-cell\\">("+esc(passedA[i].evidence)+")</span>":"")+"</li>";
      h+="</ul>";
    }
    if(failedA.length>0){
      h+='<h4>Failed Assertions</h4><ul class="expect-list fail">';
      for(var i=0;i<failedA.length;i++)h+="<li>"+esc(failedA[i].text)+(failedA[i].evidence?" <span class=\\"reasoning-cell\\">("+esc(failedA[i].evidence)+")</span>":"")+"</li>";
      h+="</ul>";
    }

    /* tool calls */
    if(r._toolCalls){
      var tc=r._toolCalls,tcArr=[];
      for(var k in tc)tcArr.push({name:k,count:tc[k]});
      tcArr.sort(function(a,b){return b.count-a.count;});
      h+='<h4>Tool Calls</h4><div class="tool-calls">';
      for(var i=0;i<tcArr.length;i++)h+='<span class="tool-tag">'+esc(tcArr[i].name)+": "+tcArr[i].count+"</span>";
      h+="</div>";
    }

    /* error */
    if(r.error)h+='<div class="error-box"><h4>Error</h4><pre>'+esc(r.error)+"</pre></div>";

    /* metadata */
    h+='<div class="detail-meta">';
    var m=[];
    if(r.tokenUsage)m.push(fmtTok(r.tokenUsage.input)+" in / "+fmtTok(r.tokenUsage.output)+" out tokens");
    if(r.durationMs){
      if(r._graderDurationMs>0){
        var execMs=r.durationMs-r._graderDurationMs;
        m.push(fmtDur(execMs>0?execMs:0)+" executor + "+fmtDur(r._graderDurationMs)+" grader");
      }else{
        m.push(fmtDur(r.durationMs));
      }
    }
    if(r.target)m.push(r.target);
    if(r.costUsd)m.push(fmtCost(r.costUsd));
    if(r.timestamp)m.push(r.timestamp);
    h+=esc(m.join(" \\u00B7 "));
    h+="</div>";

    /* feedback section */
    var tid=r.testId||"";
    var existingComment=feedbackCache[tid]||"";
    h+='<div class="feedback-section">';
    h+='<h4>Feedback</h4>';
    h+='<textarea class="feedback-input" data-test-id="'+esc(tid)+'" placeholder="Add feedback for this test..." onclick="event.stopPropagation()">'+esc(existingComment)+'</textarea>';
    h+='<div style="display:flex;align-items:center">';
    h+='<button class="feedback-submit" data-test-id="'+esc(tid)+'">Save Feedback</button>';
    h+='<span class="feedback-status"></span>';
    h+='</div></div>';

    h+="</div>";
    return h;
  }

  /* ---- run picker ---- */
  var runPicker=document.getElementById("run-picker");
  var knownRunFilenames=[];

  function refreshRunList(){
    fetch("/api/runs").then(function(r){return r.json();}).then(function(d){
      if(!d||!d.runs)return;
      var runs=d.runs;
      var newFilenames=runs.map(function(r){return r.filename;});

      /* Detect new runs that appeared since last poll */
      if(knownRunFilenames.length>0){
        var hasNew=newFilenames.some(function(f){return knownRunFilenames.indexOf(f)===-1;});
        if(hasNew&&DATA.length===0){
          /* Auto-load the first (most recent) run when starting from empty state */
          loadRun(runs[0].filename);
        }
      }
      knownRunFilenames=newFilenames;

      /* Rebuild picker options */
      var h='<option value="">Select a result file...</option>';
      if(runs.length===0){
        h='<option value="">No result files</option>';
      }
      for(var i=0;i<runs.length;i++){
        var r=runs[i];
        var label=r.filename+" ("+r.test_count+" tests, "+(r.pass_rate*100).toFixed(0)+"% pass)";
        h+='<option value="'+esc(r.filename)+'">'+esc(label)+"</option>";
      }
      runPicker.innerHTML=h;
      /* Pre-select the initially loaded run */
      if(INITIAL_SOURCE&&runs.length>0){
        runPicker.value=INITIAL_SOURCE;
      }
    }).catch(function(err){console.warn("Failed to refresh run list:",err);});
  }

  function loadRun(filename){
    fetch("/api/runs/"+encodeURIComponent(filename)).then(function(r){return r.json();}).then(function(d){
      if(d.error){console.error(d.error);return;}
      DATA=d.results;
      stats=computeStats(DATA);
      tgtStats=computeTargets(DATA);
      tgtNames=tgtStats.map(function(t){return t.target;});
      state.expanded={};
      feedbackCache={};
      loadFeedback();
      render();
      /* Update picker selection */
      runPicker.value=filename;
    }).catch(function(err){console.error("Failed to load run:",err);});
  }

  runPicker.addEventListener("change",function(){
    var val=runPicker.value;
    if(val)loadRun(val);
  });

  /* Poll for new result files every 5 seconds */
  refreshRunList();
  setInterval(refreshRunList,5000);

  /* ---- init ---- */
  loadFeedback();
  render();
})();
`;

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsServeCommand = command({
  name: 'studio',
  description: 'Start AgentV Studio — a local dashboard for reviewing evaluation results',
  args: {
    source: positional({
      type: optional(string),
      displayName: 'source',
      description: 'JSONL result file to serve (defaults to most recent in .agentv/results/)',
    }),
    port: option({
      type: optional(number),
      long: 'port',
      short: 'p',
      description: 'Port to listen on (flag → PORT env var → 3117)',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ source, port, dir }) => {
    const cwd = dir ?? process.cwd();
    const listenPort = port ?? (process.env.PORT ? Number(process.env.PORT) : 3117);

    try {
      let results: EvaluationResult[] = [];
      let sourceFile: string | undefined;

      // When a source is explicitly provided, it must exist.
      // Otherwise, try to auto-discover results; start empty if none found.
      if (source) {
        const resolved = resolveResultSourcePath(source, cwd);
        if (!existsSync(resolved)) {
          console.error(`Error: Source file not found: ${resolved}`);
          process.exit(1);
        }
        sourceFile = resolved;
        results = patchTestIds(loadManifestResults(resolved));
      } else {
        // Auto-discover: run cache -> directory scan -> empty state
        const cache = await loadRunCache(cwd);
        const cachedFile = cache ? resolveRunCacheFile(cache) : '';
        if (cachedFile && existsSync(cachedFile)) {
          sourceFile = cachedFile;
          results = patchTestIds(loadManifestResults(cachedFile));
        } else {
          const metas = listResultFiles(cwd, 1);
          if (metas.length > 0) {
            sourceFile = metas[0].path;
            results = patchTestIds(loadManifestResults(metas[0].path));
          }
          // If no metas, results stays empty — dashboard shows welcome state
        }
      }

      // Use the run directory for feedback storage (matches #764 behavior)
      const resultDir = sourceFile ? path.dirname(path.resolve(sourceFile)) : cwd;
      const app = createApp(results, resultDir, cwd, sourceFile);

      if (results.length > 0 && sourceFile) {
        console.log(`Serving ${results.length} result(s) from ${sourceFile}`);
      } else {
        console.log('No results found. Dashboard will show an empty state.');
        console.log('Run an evaluation to see results: agentv eval <eval-file>');
      }
      console.log(`Dashboard: http://localhost:${listenPort}`);
      console.log(`Feedback API: http://localhost:${listenPort}/api/feedback`);
      console.log(`Result picker API: http://localhost:${listenPort}/api/runs`);
      console.log(`Feedback file: ${feedbackPath(resultDir)}`);
      console.log('Press Ctrl+C to stop');

      const { serve: startServer } = await import('@hono/node-server');
      // serve() returns a Node http.Server — its 'listening' event keeps
      // the process alive. We await a never-resolving promise so the
      // cmd-ts handler doesn't return and let the process exit.
      startServer({
        fetch: app.fetch,
        port: listenPort,
      });
      await new Promise(() => {});
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
