/**
 * `agentv studio` — starts the AgentV Studio server, a React SPA for
 * reviewing evaluation results.
 *
 * The server uses Hono for routing and @hono/node-server to listen.
 * The Studio SPA is served from a pre-built dist directory.
 *
 * API endpoints:
 *   - GET /           — Studio SPA (React app)
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
  options?: { studioDir?: string },
): Hono {
  const searchDir = cwd ?? resultDir;
  const app = new Hono();

  // Dashboard HTML — serve Studio SPA (React app).
  const studioDistPath = options?.studioDir ?? resolveStudioDistDir();
  if (!studioDistPath || !existsSync(path.join(studioDistPath, 'index.html'))) {
    throw new Error('Studio dist not found. Run "bun run build" in apps/studio/ to build the SPA.');
  }
  app.get('/', (c) => {
    const indexPath = path.join(studioDistPath, 'index.html');
    if (existsSync(indexPath)) {
      return c.html(readFileSync(indexPath, 'utf8'));
    }
    return c.notFound();
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
    // Bundled inside CLI dist (published package: dist/studio/)
    path.resolve(currentDir, 'studio'),
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
 * Used by JSON API responses to reduce payload size.
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
