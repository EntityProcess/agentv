/**
 * `agentv studio` — starts the AgentV Studio server, a React SPA for
 * reviewing evaluation results.
 *
 * The server uses Hono for routing and @hono/node-server to listen.
 * The Studio SPA is served from a pre-built dist directory.
 *
 * API endpoints:
 *   - GET /           — Studio SPA (React app)
 *   - GET /api/runs   — list available run workspaces with metadata
 *   - GET /api/runs/:filename — load results from a specific run workspace
 *   - GET /api/feedback  — read feedback reviews
 *   - POST /api/feedback — write feedback reviews
 *   - GET /api/projects  — list registered projects
 *   - GET /api/projects/:projectId/runs — project-scoped run list
 *
 * All data routes (runs, suites, categories, evals, experiments, targets)
 * exist in both unscoped (/api/...) and project-scoped (/api/projects/:projectId/...)
 * variants. They share handler functions via DataContext, differing only in
 * how searchDir is resolved.
 *
 * Exported functions (for testing):
 *   - resolveSourceFile(source, cwd) — resolves a run manifest path
 *   - loadResults(content) — parses JSONL into EvaluationResult[]
 *   - createApp(results, cwd) — Hono app factory
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, flag, number, option, optional, positional, string } from 'cmd-ts';

import {
  DEFAULT_CATEGORY,
  type EvaluationResult,
  addProject,
  discoverProjects,
  getProject,
  loadProjectRegistry,
  removeProject,
} from '@agentv/core';
import type { Context } from 'hono';
import { Hono } from 'hono';

import { parseJsonlResults } from '../eval/artifact-writer.js';
import { resolveRunManifestPath } from '../eval/result-layout.js';
import { loadRunCache, resolveRunCacheFile } from '../eval/run-cache.js';
import { listResultFiles } from '../inspect/utils.js';
import { registerEvalRoutes } from './eval-runner.js';
import {
  loadLightweightResults,
  loadManifestResults,
  parseResultManifest,
  resolveResultSourcePath,
} from './manifest.js';
import {
  findRunById,
  getRemoteResultsStatus,
  listMergedResultFiles,
  syncRemoteResults,
} from './remote.js';
import { type StudioConfig, loadStudioConfig, saveStudioConfig } from './studio-config.js';

// ── Source resolution ────────────────────────────────────────────────────

/**
 * Resolve a run manifest path from an explicit source, run cache,
 * or directory scan. Throws if no run workspace can be found.
 */
export async function resolveSourceFile(source: string | undefined, cwd: string): Promise<string> {
  if (source) {
    let resolved = resolveResultSourcePath(source, cwd);
    if (!existsSync(resolved)) {
      throw new Error(`Source file not found: ${resolved}`);
    }
    resolved = resolveRunManifestPath(resolved);
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
      'No run workspaces found in .agentv/results/runs/\nRun an evaluation first: agentv eval <eval-file>',
    );
  }
  if (metas.length > 1) {
    console.log('Available run workspaces:');
    for (const m of metas) {
      console.log(`  ${m.path}`);
    }
    console.log(`\nServing most recent: ${metas[0].path}\n`);
  }
  return metas[0].path;
}

// ── JSONL parsing ────────────────────────────────────────────────────────

/**
 * Parse JSONL content into EvaluationResult[].
 */
export function loadResults(content: string): EvaluationResult[] {
  const results = parseJsonlResults(content);
  if (results.length === 0) {
    throw new Error('No valid results found in JSONL content');
  }

  return results;
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

// ── Shared utilities (used by handler functions) ─────────────────────────

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

/**
 * Strip heavy fields (requests, trace) from results for JSON API responses.
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

// ── Shared data-route handlers ───────────────────────────────────────────
//
// Each handler takes a Hono Context and a DataContext (resolved directories).
// Both unscoped and project-scoped routes call the same handler, differing
// only in how the DataContext is constructed.

interface DataContext {
  searchDir: string;
  agentvDir: string;
}

// biome-ignore lint/suspicious/noExplicitAny: Hono Context generic varies by route
type C = Context<any, any, any>;

async function handleRuns(c: C, { searchDir }: DataContext) {
  const { runs: metas } = await listMergedResultFiles(searchDir);
  return c.json({
    runs: metas.map((m) => {
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
        display_name: m.displayName,
        path: m.path,
        timestamp: m.timestamp,
        test_count: m.testCount,
        pass_rate: m.passRate,
        avg_score: m.avgScore,
        size_bytes: m.sizeBytes,
        source: m.source,
        ...(target && { target }),
        ...(experiment && { experiment }),
      };
    }),
  });
}

async function handleRunDetail(c: C, { searchDir }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = loadManifestResults(meta.path);
    return c.json({
      results: stripHeavyFields(loaded),
      source: meta.source,
      source_label: meta.displayName,
    });
  } catch {
    return c.json({ error: 'Failed to load run' }, 500);
  }
}

async function handleRunSuites(c: C, { searchDir, agentvDir }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = loadManifestResults(meta.path);
    const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
    const suiteMap = new Map<string, { total: number; passed: number; scoreSum: number }>();
    for (const r of loaded) {
      const ds = r.suite ?? r.target ?? 'default';
      const entry = suiteMap.get(ds) ?? { total: 0, passed: 0, scoreSum: 0 };
      entry.total++;
      if (r.score >= pass_threshold) entry.passed++;
      entry.scoreSum += r.score;
      suiteMap.set(ds, entry);
    }
    const suites = [...suiteMap.entries()].map(([name, entry]) => ({
      name,
      total: entry.total,
      passed: entry.passed,
      failed: entry.total - entry.passed,
      avg_score: entry.total > 0 ? entry.scoreSum / entry.total : 0,
    }));
    return c.json({ suites });
  } catch {
    return c.json({ error: 'Failed to load suites' }, 500);
  }
}

async function handleRunCategories(c: C, { searchDir, agentvDir }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = loadManifestResults(meta.path);
    const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
    const categoryMap = new Map<
      string,
      { total: number; passed: number; scoreSum: number; suites: Set<string> }
    >();
    for (const r of loaded) {
      const cat = r.category ?? DEFAULT_CATEGORY;
      const entry = categoryMap.get(cat) ?? {
        total: 0,
        passed: 0,
        scoreSum: 0,
        suites: new Set<string>(),
      };
      entry.total++;
      if (r.score >= pass_threshold) entry.passed++;
      entry.scoreSum += r.score;
      entry.suites.add(r.suite ?? r.target ?? 'default');
      categoryMap.set(cat, entry);
    }
    const categories = [...categoryMap.entries()].map(([name, entry]) => ({
      name,
      total: entry.total,
      passed: entry.passed,
      failed: entry.total - entry.passed,
      avg_score: entry.total > 0 ? entry.scoreSum / entry.total : 0,
      suite_count: entry.suites.size,
    }));
    return c.json({ categories });
  } catch {
    return c.json({ error: 'Failed to load categories' }, 500);
  }
}

async function handleCategorySuites(c: C, { searchDir, agentvDir }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const category = decodeURIComponent(c.req.param('category') ?? '');
  const meta = await findRunById(searchDir, filename);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = loadManifestResults(meta.path);
    const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
    const filtered = loaded.filter((r) => (r.category ?? DEFAULT_CATEGORY) === category);
    const suiteMap = new Map<string, { total: number; passed: number; scoreSum: number }>();
    for (const r of filtered) {
      const ds = r.suite ?? r.target ?? 'default';
      const entry = suiteMap.get(ds) ?? { total: 0, passed: 0, scoreSum: 0 };
      entry.total++;
      if (r.score >= pass_threshold) entry.passed++;
      entry.scoreSum += r.score;
      suiteMap.set(ds, entry);
    }
    const suites = [...suiteMap.entries()].map(([name, entry]) => ({
      name,
      total: entry.total,
      passed: entry.passed,
      failed: entry.total - entry.passed,
      avg_score: entry.total > 0 ? entry.scoreSum / entry.total : 0,
    }));
    return c.json({ suites });
  } catch {
    return c.json({ error: 'Failed to load suites' }, 500);
  }
}

async function handleEvalDetail(c: C, { searchDir }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const evalId = c.req.param('evalId');
  const meta = await findRunById(searchDir, filename);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = loadManifestResults(meta.path);
    const result = loaded.find((r) => r.testId === evalId);
    if (!result) return c.json({ error: 'Eval not found' }, 404);
    return c.json({ eval: result });
  } catch {
    return c.json({ error: 'Failed to load eval' }, 500);
  }
}

async function handleEvalFiles(c: C, { searchDir }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const evalId = c.req.param('evalId');
  const meta = await findRunById(searchDir, filename);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const content = readFileSync(meta.path, 'utf8');
    const records = parseResultManifest(content);
    const record = records.find((r) => r.test_id === evalId);
    if (!record) return c.json({ error: 'Eval not found' }, 404);

    const baseDir = path.dirname(meta.path);
    const knownPaths = [
      record.grading_path,
      record.timing_path,
      record.input_path,
      record.output_path,
      record.response_path,
    ].filter((p): p is string => !!p);

    if (knownPaths.length === 0) return c.json({ files: [] });

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
}

async function handleEvalFileContent(c: C, { searchDir }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename);
  if (!meta) return c.json({ error: 'Run not found' }, 404);

  // Extract the wildcard suffix without depending on decoded route params.
  const marker = '/files/';
  const markerIdx = c.req.path.indexOf(marker);
  const filePath = markerIdx >= 0 ? c.req.path.slice(markerIdx + marker.length) : '';

  if (!filePath) return c.json({ error: 'No file path specified' }, 400);

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
}

async function handleExperiments(c: C, { searchDir, agentvDir }: DataContext) {
  const { runs: metas } = await listMergedResultFiles(searchDir);
  const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
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
        if (r.score >= pass_threshold) entry.passedCount++;
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
}

async function handleCompare(c: C, { searchDir, agentvDir }: DataContext) {
  const { runs: metas } = await listMergedResultFiles(searchDir);
  const { threshold: pass_threshold } = loadStudioConfig(agentvDir);

  // Collect per-test-case results keyed by experiment × target
  const cellMap = new Map<
    string,
    {
      experiment: string;
      target: string;
      evalCount: number;
      passedCount: number;
      scoreSum: number;
      tests: Array<{
        test_id: string;
        score: number;
        passed: boolean;
        execution_status?: string;
      }>;
    }
  >();

  const experimentsSet = new Set<string>();
  const targetsSet = new Set<string>();

  for (const m of metas) {
    try {
      const records = loadLightweightResults(m.path);
      for (const r of records) {
        const experiment = r.experiment ?? 'default';
        const target = r.target ?? 'default';
        experimentsSet.add(experiment);
        targetsSet.add(target);
        const key = JSON.stringify([experiment, target]);
        const entry = cellMap.get(key) ?? {
          experiment,
          target,
          evalCount: 0,
          passedCount: 0,
          scoreSum: 0,
          tests: [],
        };
        const passed = r.score >= pass_threshold;
        entry.evalCount++;
        if (passed) entry.passedCount++;
        entry.scoreSum += r.score;
        entry.tests.push({
          test_id: r.testId,
          score: r.score,
          passed,
          execution_status: r.executionStatus,
        });
        cellMap.set(key, entry);
      }
    } catch {
      // skip runs that fail to load
    }
  }

  const MAX_TESTS_PER_CELL = 100;

  const cells = [...cellMap.values()].map((entry) => {
    // Deduplicate tests: keep only the latest entry per test_id (last wins by insertion order)
    const dedupMap = new Map<string, (typeof entry.tests)[number]>();
    for (const t of entry.tests) {
      dedupMap.set(t.test_id, t);
    }
    const dedupedTests = [...dedupMap.values()];

    // Cap to most recent entries to prevent unbounded payloads
    const cappedTests = dedupedTests.slice(-MAX_TESTS_PER_CELL);

    return {
      experiment: entry.experiment,
      target: entry.target,
      eval_count: entry.evalCount,
      passed_count: entry.passedCount,
      pass_rate: entry.evalCount > 0 ? entry.passedCount / entry.evalCount : 0,
      avg_score: entry.evalCount > 0 ? entry.scoreSum / entry.evalCount : 0,
      tests: cappedTests,
    };
  });

  return c.json({
    experiments: [...experimentsSet].sort(),
    targets: [...targetsSet].sort(),
    cells,
  });
}

async function handleTargets(c: C, { searchDir, agentvDir }: DataContext) {
  const { runs: metas } = await listMergedResultFiles(searchDir);
  const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
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
        if (r.score >= pass_threshold) entry.passedCount++;
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
}

function handleConfig(c: C, { agentvDir }: DataContext, options?: { readOnly?: boolean }) {
  return c.json({
    ...loadStudioConfig(agentvDir),
    read_only: options?.readOnly === true,
  });
}

function handleFeedbackRead(c: C, { searchDir }: DataContext) {
  const resultsDir = path.join(searchDir, '.agentv', 'results');
  return c.json(readFeedback(existsSync(resultsDir) ? resultsDir : searchDir));
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
  options?: { studioDir?: string; readOnly?: boolean },
): Hono {
  const searchDir = cwd ?? resultDir;
  const agentvDir = path.join(searchDir, '.agentv');
  const defaultCtx: DataContext = { searchDir, agentvDir };
  const readOnly = options?.readOnly === true;
  const app = new Hono();

  // ── Project resolution wrapper ────────────────────────────────────────
  // Resolves projectId → DataContext, returning 404 if not found.
  function withProject(
    c: C,
    handler: (c: C, ctx: DataContext) => Response | Promise<Response>,
  ): Response | Promise<Response> {
    const project = getProject(c.req.param('projectId') ?? '');
    if (!project || !existsSync(project.path)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return handler(c, {
      searchDir: project.path,
      agentvDir: path.join(project.path, '.agentv'),
    });
  }

  // ── Studio configuration ──────────────────────────────────────────────

  app.post('/api/config', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Studio is running in read-only mode' }, 403);
    }
    try {
      const body = await c.req.json<Partial<StudioConfig>>();
      const current = loadStudioConfig(agentvDir);
      const updated = { ...current, ...body };
      if (typeof updated.threshold === 'number') {
        updated.threshold = Math.min(1, Math.max(0, updated.threshold));
      }
      saveStudioConfig(agentvDir, updated);
      return c.json(updated);
    } catch {
      return c.json({ error: 'Failed to save config' }, 500);
    }
  });

  // ── Project management endpoints ─────────────────────────────────────

  /** Convert a ProjectEntry to snake_case wire format. */
  function projectEntryToWire(entry: {
    id: string;
    name: string;
    path: string;
    addedAt: string;
    lastOpenedAt: string;
  }) {
    return {
      id: entry.id,
      name: entry.name,
      path: entry.path,
      added_at: entry.addedAt,
      last_opened_at: entry.lastOpenedAt,
    };
  }

  app.get('/api/projects', async (c) => {
    const registry = loadProjectRegistry();
    const projects = await Promise.all(
      registry.projects.map(async (p) => {
        let runCount = 0;
        let passRate = 0;
        let lastRun: string | null = null;
        try {
          const { runs: metas } = await listMergedResultFiles(p.path);
          runCount = metas.length;
          if (metas.length > 0) {
            const totalPassRate = metas.reduce((sum, m) => sum + m.passRate, 0);
            passRate = totalPassRate / metas.length;
            lastRun = metas[0].timestamp;
          }
        } catch {
          // Project path may be missing or inaccessible
        }
        return {
          ...projectEntryToWire(p),
          run_count: runCount,
          pass_rate: passRate,
          last_run: lastRun,
        };
      }),
    );
    return c.json({ projects });
  });

  app.post('/api/projects', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Studio is running in read-only mode' }, 403);
    }
    try {
      const body = await c.req.json<{ path: string }>();
      if (!body.path) return c.json({ error: 'Missing path' }, 400);
      const entry = addProject(body.path);
      return c.json(projectEntryToWire(entry), 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.delete('/api/projects/:projectId', (c) => {
    if (readOnly) {
      return c.json({ error: 'Studio is running in read-only mode' }, 403);
    }
    const removed = removeProject(c.req.param('projectId') ?? '');
    if (!removed) return c.json({ error: 'Project not found' }, 404);
    return c.json({ ok: true });
  });

  app.get('/api/projects/:projectId/summary', async (c) => {
    const project = getProject(c.req.param('projectId') ?? '');
    if (!project) return c.json({ error: 'Project not found' }, 404);
    try {
      const { runs: metas } = await listMergedResultFiles(project.path);
      const runCount = metas.length;
      const passRate = runCount > 0 ? metas.reduce((s, m) => s + m.passRate, 0) / runCount : 0;
      const lastRun = metas.length > 0 ? metas[0].timestamp : null;
      return c.json({
        id: project.id,
        name: project.name,
        path: project.path,
        run_count: runCount,
        pass_rate: passRate,
        last_run: lastRun,
      });
    } catch {
      return c.json({ error: 'Failed to read project' }, 500);
    }
  });

  app.post('/api/projects/discover', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Studio is running in read-only mode' }, 403);
    }
    try {
      const body = await c.req.json<{ path: string }>();
      if (!body.path) return c.json({ error: 'Missing path' }, 400);
      const discovered = discoverProjects(body.path);
      const registered = discovered.map((p) => projectEntryToWire(addProject(p)));
      return c.json({ discovered: registered });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  /** Aggregate runs from all registered projects, sorted by timestamp descending. */
  app.get('/api/projects/all-runs', async (c) => {
    const registry = loadProjectRegistry();
    const allRuns: Array<{
      filename: string;
      display_name: string;
      path: string;
      timestamp: string;
      test_count: number;
      pass_rate: number;
      avg_score: number;
      size_bytes: number;
      target?: string;
      experiment?: string;
      source: 'local' | 'remote';
      project_id: string;
      project_name: string;
    }> = [];

    for (const p of registry.projects) {
      try {
        const { runs: metas } = await listMergedResultFiles(p.path);
        for (const m of metas) {
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
          allRuns.push({
            filename: m.filename,
            display_name: m.displayName,
            path: m.path,
            timestamp: m.timestamp,
            test_count: m.testCount,
            pass_rate: m.passRate,
            avg_score: m.avgScore,
            size_bytes: m.sizeBytes,
            source: m.source,
            ...(target && { target }),
            ...(experiment && { experiment }),
            project_id: p.id,
            project_name: p.name,
          });
        }
      } catch {
        // skip inaccessible projects
      }
    }

    allRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return c.json({ runs: allRuns });
  });

  // ── Data routes (unscoped) ────────────────────────────────────────────

  app.get('/api/config', (c) => handleConfig(c, defaultCtx, { readOnly }));
  app.get('/api/remote/status', async (c) => c.json(await getRemoteResultsStatus(searchDir)));
  app.post('/api/remote/sync', async (c) => c.json(await syncRemoteResults(searchDir)));
  app.get('/api/runs', (c) => handleRuns(c, defaultCtx));
  app.get('/api/runs/:filename', (c) => handleRunDetail(c, defaultCtx));
  app.get('/api/runs/:filename/suites', (c) => handleRunSuites(c, defaultCtx));
  app.get('/api/runs/:filename/categories', (c) => handleRunCategories(c, defaultCtx));
  app.get('/api/runs/:filename/categories/:category/suites', (c) =>
    handleCategorySuites(c, defaultCtx),
  );
  app.get('/api/runs/:filename/evals/:evalId', (c) => handleEvalDetail(c, defaultCtx));
  app.get('/api/runs/:filename/evals/:evalId/files', (c) => handleEvalFiles(c, defaultCtx));
  app.get('/api/runs/:filename/evals/:evalId/files/*', (c) => handleEvalFileContent(c, defaultCtx));
  app.get('/api/experiments', (c) => handleExperiments(c, defaultCtx));
  app.get('/api/compare', (c) => handleCompare(c, defaultCtx));
  app.get('/api/targets', (c) => handleTargets(c, defaultCtx));

  // Feedback (unscoped — read uses defaultCtx.searchDir as resultDir)
  app.get('/api/feedback', (c) => {
    const data = readFeedback(resultDir);
    return c.json(data);
  });

  app.post('/api/feedback', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Studio is running in read-only mode' }, 403);
    }
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

  // Aggregated index (unscoped only)
  app.get('/api/index', async (c) => {
    const { runs: metas } = await listMergedResultFiles(searchDir);
    const entries = metas.map((m) => {
      let totalCostUsd = 0;
      try {
        const loaded = loadManifestResults(m.path);
        totalCostUsd = loaded.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      } catch {
        // ignore load errors for aggregate
      }
      return {
        run_filename: m.filename,
        display_name: m.displayName,
        test_count: m.testCount,
        pass_rate: m.passRate,
        avg_score: m.avgScore,
        total_cost_usd: totalCostUsd,
        timestamp: m.timestamp,
      };
    });
    return c.json({ entries });
  });

  // ── Data routes (project-scoped) ──────────────────────────────────────
  // Same handlers as above, with project-resolved DataContext via withProject.

  app.get('/api/projects/:projectId/config', (c) =>
    withProject(c, (ctx, dataCtx) => handleConfig(ctx, dataCtx, { readOnly })),
  );
  app.get('/api/projects/:projectId/remote/status', (c) =>
    withProject(c, async (ctx, dataCtx) =>
      ctx.json(await getRemoteResultsStatus(dataCtx.searchDir)),
    ),
  );
  app.post('/api/projects/:projectId/remote/sync', (c) =>
    withProject(c, async (ctx, dataCtx) => ctx.json(await syncRemoteResults(dataCtx.searchDir))),
  );
  app.get('/api/projects/:projectId/runs', (c) => withProject(c, handleRuns));
  app.get('/api/projects/:projectId/runs/:filename', (c) => withProject(c, handleRunDetail));
  app.get('/api/projects/:projectId/runs/:filename/suites', (c) => withProject(c, handleRunSuites));
  app.get('/api/projects/:projectId/runs/:filename/categories', (c) =>
    withProject(c, handleRunCategories),
  );
  app.get('/api/projects/:projectId/runs/:filename/categories/:category/suites', (c) =>
    withProject(c, handleCategorySuites),
  );
  app.get('/api/projects/:projectId/runs/:filename/evals/:evalId', (c) =>
    withProject(c, handleEvalDetail),
  );
  app.get('/api/projects/:projectId/runs/:filename/evals/:evalId/files', (c) =>
    withProject(c, handleEvalFiles),
  );
  app.get('/api/projects/:projectId/runs/:filename/evals/:evalId/files/*', (c) =>
    withProject(c, handleEvalFileContent),
  );
  app.get('/api/projects/:projectId/experiments', (c) => withProject(c, handleExperiments));
  app.get('/api/projects/:projectId/compare', (c) => withProject(c, handleCompare));
  app.get('/api/projects/:projectId/targets', (c) => withProject(c, handleTargets));
  app.get('/api/projects/:projectId/feedback', (c) => withProject(c, handleFeedbackRead));

  // ── Eval runner routes (discovery, launch, status) ────────────────────

  registerEvalRoutes(
    app,
    (c) => {
      // For project-scoped routes, resolve to project path; otherwise use searchDir
      const projectId = c.req.param('projectId');
      if (projectId) {
        const project = getProject(projectId);
        if (project) return project.path;
      }
      return searchDir;
    },
    { readOnly },
  );

  // ── Static file serving for Studio SPA ────────────────────────────────

  const studioDistPath = options?.studioDir ?? resolveStudioDistDir();
  if (!studioDistPath || !existsSync(path.join(studioDistPath, 'index.html'))) {
    throw new Error('Studio dist not found. Run "bun run build" in apps/studio/ to build the SPA.');
  }

  app.get('/', (c) => {
    const indexPath = path.join(studioDistPath, 'index.html');
    if (existsSync(indexPath)) return c.html(readFileSync(indexPath, 'utf8'));
    return c.notFound();
  });

  app.get('/assets/*', (c) => {
    const assetPath = c.req.path;
    const filePath = path.join(studioDistPath, assetPath);
    if (!existsSync(filePath)) return c.notFound();
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
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    const indexPath = path.join(studioDistPath, 'index.html');
    if (existsSync(indexPath)) return c.html(readFileSync(indexPath, 'utf8'));
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

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsServeCommand = command({
  name: 'studio',
  description: 'Start AgentV Studio — a local dashboard for reviewing evaluation results',
  args: {
    source: positional({
      type: optional(string),
      displayName: 'source',
      description:
        'Run workspace directory or index.jsonl manifest to serve (defaults to most recent in .agentv/results/runs/)',
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
    multi: flag({
      long: 'multi',
      description: 'Launch in multi-project dashboard mode',
    }),
    add: option({
      type: optional(string),
      long: 'add',
      description: 'Register a project by path',
    }),
    remove: option({
      type: optional(string),
      long: 'remove',
      description: 'Unregister a project by ID',
    }),
    discover: option({
      type: optional(string),
      long: 'discover',
      description: 'Scan a directory tree for repos with .agentv/',
    }),
    readOnly: flag({
      long: 'read-only',
      description: 'Disable write operations and launch Studio in read-only leaderboard mode',
    }),
  },
  handler: async ({ source, port, dir, multi, add, remove, discover, readOnly }) => {
    const cwd = dir ?? process.cwd();
    const listenPort = port ?? (process.env.PORT ? Number(process.env.PORT) : 3117);

    // ── Project management commands (non-server) ─────────────────────
    if (add) {
      try {
        const entry = addProject(add);
        console.log(`Registered project: ${entry.name} (${entry.id}) at ${entry.path}`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }

    if (remove) {
      const removed = removeProject(remove);
      if (removed) {
        console.log(`Unregistered project: ${remove}`);
      } else {
        console.error(`Project not found: ${remove}`);
        process.exit(1);
      }
      return;
    }

    if (discover) {
      const discovered = discoverProjects(discover);
      if (discovered.length === 0) {
        console.log(`No projects with .agentv/ found under ${discover}`);
        return;
      }
      for (const p of discovered) {
        const entry = addProject(p);
        console.log(`Registered: ${entry.name} (${entry.id}) at ${entry.path}`);
      }
      console.log(`\nDiscovered ${discovered.length} project(s).`);
      return;
    }

    // ── Determine multi-project mode ────────────────────────────────
    const registry = loadProjectRegistry();
    const isMultiProject = multi || registry.projects.length > 0;

    try {
      let results: EvaluationResult[] = [];
      let sourceFile: string | undefined;

      // When a source is explicitly provided, it must exist.
      // Otherwise, try to auto-discover results; start empty if none found.
      if (source) {
        sourceFile = await resolveSourceFile(source, cwd);
        results = loadManifestResults(sourceFile);
      } else {
        // Auto-discover: run cache -> directory scan -> empty state
        const cache = await loadRunCache(cwd);
        const cachedFile = cache ? resolveRunCacheFile(cache) : '';
        if (cachedFile && existsSync(cachedFile)) {
          sourceFile = cachedFile;
          results = loadManifestResults(cachedFile);
        } else {
          const metas = listResultFiles(cwd, 1);
          if (metas.length > 0) {
            sourceFile = metas[0].path;
            results = loadManifestResults(metas[0].path);
          }
          // If no metas, results stays empty — dashboard shows welcome state
        }
      }

      // Use the run directory for feedback storage (matches #764 behavior)
      const resultDir = sourceFile ? path.dirname(path.resolve(sourceFile)) : cwd;
      const app = createApp(results, resultDir, cwd, sourceFile, { readOnly });

      if (isMultiProject) {
        console.log(`Multi-project mode: ${registry.projects.length} project(s) registered`);
      } else if (results.length > 0 && sourceFile) {
        console.log(`Serving ${results.length} result(s) from ${sourceFile}`);
      } else {
        console.log('No results found. Dashboard will show an empty state.');
        console.log('Run an evaluation to see results: agentv eval <eval-file>');
      }
      console.log(`Dashboard: http://localhost:${listenPort}`);
      console.log(`Projects API: http://localhost:${listenPort}/api/projects`);
      console.log('Press Ctrl+C to stop');

      const { serve: startServer } = await import('@hono/node-server');
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
