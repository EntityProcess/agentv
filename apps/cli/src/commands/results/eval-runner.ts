/**
 * Dashboard eval runner — discovery, launch, and status tracking for eval runs
 * initiated from the Dashboard UI.
 *
 * Provides Hono route handlers for:
 *   - GET  /api/eval/discover  — discover eval files in the project
 *   - GET  /api/eval/targets   — list available target names
 *   - POST /api/eval/run       — launch an eval run as a child process
 *   - GET  /api/eval/status/:id — poll running eval status
 *   - GET  /api/eval/runs      — list active and recent Dashboard-launched runs
 *
 * All handlers accept a `cwd` (project root) to resolve paths against.
 * The module spawns `bun apps/cli/src/cli.ts eval run ...` and tracks
 * process state in memory.
 *
 * Stdout/stderr are also persisted to `<outputDir>/console.log` so that
 * RunDetail can show the full captured log after the in-memory buffers are
 * pruned. The static log file is served by the run-log routes registered in
 * `serve.ts` via `getActiveRunStatus`/`getActiveRunTarget` cross-referencing.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { type WriteStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTargetNames, readTargetDefinitions } from '@agentv/core';
import type { Context } from 'hono';
import type { Hono } from 'hono';

import { TARGET_FILE_CANDIDATES } from '../../utils/targets.js';
import { discoverEvalFiles } from '../eval/discover.js';
import { buildDefaultRunDir, normalizeExperimentName } from '../eval/result-layout.js';
import { findRepoRoot } from '../eval/shared.js';
import { normalizeTags, writeRunTags } from './run-tags.js';

// ── In-memory run tracker ────────────────────────────────────────────────

interface DashboardRun {
  id: string;
  status: 'starting' | 'running' | 'finished' | 'failed';
  command: string;
  /** Target name passed via --target (if any). Stored so the run list can show it before the first result is written. */
  target?: string;
  /** Absolute path to the run directory (e.g. .agentv/results/default/<timestamp>). Used to correlate this in-memory run with the filesystem run when the JSONL has 0 records yet. */
  outputDir?: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  process?: ChildProcess;
}

const activeRuns = new Map<string, DashboardRun>();

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `dashboard-${ts}-${rand}`;
}

// Keep only last 20 finished runs to prevent unbounded memory growth
function pruneFinishedRuns() {
  const finished = [...activeRuns.entries()]
    .filter(([, r]) => r.status === 'finished' || r.status === 'failed')
    .sort((a, b) => (b[1].finishedAt ?? '').localeCompare(a[1].finishedAt ?? ''));
  if (finished.length > 20) {
    for (const [id] of finished.slice(20)) {
      activeRuns.delete(id);
    }
  }
}

/**
 * Look up the target for a Dashboard-launched run by its index.jsonl path.
 * Called by handleRuns in serve.ts when the JSONL has 0 records (run just started).
 */
export function getActiveRunTarget(indexJsonlPath: string): string | undefined {
  for (const run of activeRuns.values()) {
    if (run.outputDir && path.join(run.outputDir, 'index.jsonl') === indexJsonlPath) {
      return run.target;
    }
  }
  return undefined;
}

/**
 * Look up the in-memory status for a Dashboard-launched run by its index.jsonl path.
 * Returns 'starting' | 'running' | 'finished' | 'failed' if the run is tracked,
 * else undefined. Used by handleRuns to render a spinner for active runs in the
 * RunList instead of a misleading red ✗ derived from a 0 pass-rate.
 */
export function getActiveRunStatus(indexJsonlPath: string): DashboardRun['status'] | undefined {
  for (const run of activeRuns.values()) {
    if (run.outputDir && path.join(run.outputDir, 'index.jsonl') === indexJsonlPath) {
      return run.status;
    }
  }
  return undefined;
}

// ── Discover targets file from project root ──────────────────────────────

async function discoverTargetsInProject(cwd: string): Promise<readonly string[]> {
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd;

  // Try to find a targets file using the standard discovery
  let targetsFilePath: string | undefined;
  for (const candidate of TARGET_FILE_CANDIDATES) {
    const fullPath = path.join(cwd, candidate);
    if (existsSync(fullPath)) {
      targetsFilePath = fullPath;
      break;
    }
  }
  if (!targetsFilePath) {
    for (const candidate of TARGET_FILE_CANDIDATES) {
      const fullPath = path.join(repoRoot, candidate);
      if (existsSync(fullPath)) {
        targetsFilePath = fullPath;
        break;
      }
    }
  }

  if (!targetsFilePath) return [];

  try {
    const definitions = await readTargetDefinitions(targetsFilePath);
    return listTargetNames(definitions);
  } catch {
    return [];
  }
}

// ── Build CLI command from request body ──────────────────────────────────

interface RunEvalRequest {
  suite_filter?: string;
  test_ids?: string[];
  target?: string;
  experiment?: string;
  tags?: string[];
  threshold?: number;
  workers?: number;
  dry_run?: boolean;
  /** Resume an interrupted run: skip already-completed tests and append results to `output`. */
  resume?: boolean;
  /** Re-run failed/errored tests while keeping passing results. */
  rerun_failed?: boolean;
  /** Path to a previous run dir or index.jsonl — re-run only execution_error cases. */
  retry_errors?: string;
  /** Artifact directory for run output. Required when resume/rerun_failed are set without auto-detect. */
  output?: string;
}

/**
 * Validate mutually-exclusive resume modes.
 * Returns an error message if invalid, or undefined if valid.
 */
function validateResumeOptions(req: RunEvalRequest): string | undefined {
  const modes: string[] = [];
  if (req.resume) modes.push('resume');
  if (req.rerun_failed) modes.push('rerun_failed');
  if (req.retry_errors?.trim()) {
    modes.push('retry_errors');
  }
  if (modes.length > 1) {
    return `resume, rerun_failed, and retry_errors are mutually exclusive (got: ${modes.join(', ')})`;
  }
  return undefined;
}

function parseInitialTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('tags must be an array of strings');
  }
  return normalizeTags(value);
}

function normalizeRunMetadata(req: RunEvalRequest): { experiment: string; tags: string[] } {
  const experiment = normalizeExperimentName(req.experiment);
  const tags = parseInitialTags(req.tags);
  if ((req.resume || req.rerun_failed) && req.experiment?.trim()) {
    throw new Error('experiment cannot be changed when resuming an existing run');
  }
  if ((req.resume || req.rerun_failed) && tags.length > 0) {
    throw new Error('initial tags can only be set when creating a new run');
  }
  return { experiment, tags };
}

function buildCliArgs(req: RunEvalRequest, experiment?: string): string[] {
  const args: string[] = ['eval'];

  // Suite filter (eval paths/globs)
  if (req.suite_filter?.trim()) {
    for (const part of req.suite_filter.split(',')) {
      const trimmed = part.trim();
      if (trimmed) args.push(trimmed);
    }
  }

  // Test ID filters
  if (req.test_ids && req.test_ids.length > 0) {
    for (const id of req.test_ids) {
      const trimmed = id.trim();
      if (trimmed) {
        args.push('--test-id', trimmed);
      }
    }
  }

  // Target override
  if (req.target?.trim()) {
    args.push('--target', req.target.trim());
  }

  if (experiment && req.experiment?.trim()) {
    args.push('--experiment', experiment);
  }

  // Threshold
  if (req.threshold !== undefined && req.threshold !== null) {
    args.push('--threshold', String(req.threshold));
  }

  // Workers
  if (req.workers !== undefined && req.workers !== null) {
    args.push('--workers', String(req.workers));
  }

  // Dry run
  if (req.dry_run) {
    args.push('--dry-run');
  }

  // Resume / rerun-failed / retry-errors / output
  if (req.output?.trim()) {
    args.push('--output', req.output.trim());
  }
  if (req.resume) {
    args.push('--resume');
  }
  if (req.rerun_failed) {
    args.push('--rerun-failed');
  }
  if (req.retry_errors?.trim()) {
    args.push('--retry-errors', req.retry_errors.trim());
  }

  return args;
}

function buildCliPreview(args: string[]): string {
  return `agentv ${args.map((a) => (a.includes(' ') || a.includes('*') ? `"${a}"` : a)).join(' ')}`;
}

// ── Resolve the bun + cli.ts path ────────────────────────────────────────

function resolveCliPath(cwd: string): { binPath: string; args: string[] } | undefined {
  // 1. Try to find cli.ts in the project (monorepo dev context)
  const candidates = [
    path.join(cwd, 'apps/cli/src/cli.ts'),
    path.join(cwd, 'apps/cli/dist/cli.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return { binPath: 'bun', args: [c] };
    }
  }

  // 2. Try from the current running process location (handles both CJS __dirname
  //    and ESM import.meta.url; fileURLToPath works correctly on Windows).
  //    Layouts we can be loaded from:
  //      - dev/source: this module sits at apps/cli/src/commands/results/eval-runner.ts,
  //        so cli.ts is two dirs up at apps/cli/src/cli.ts.
  //      - bundled dist: tsup emits the chunk into apps/cli/dist/, alongside cli.js,
  //        so the entry is in the same directory as currentDir.
  const currentDir =
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  const fromSrc = path.resolve(currentDir, '../../cli.ts');
  const fromDist = path.resolve(currentDir, 'cli.js');

  if (existsSync(fromSrc)) return { binPath: 'bun', args: [fromSrc] };
  if (existsSync(fromDist)) return { binPath: 'bun', args: [fromDist] };

  // 3. Fall back to the globally installed `agentv` command.
  //    This covers npm/bun global installs where source files aren't adjacent.
  if (isCommandAvailable('agentv')) {
    return { binPath: 'agentv', args: [] };
  }

  return undefined;
}

function isCommandAvailable(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a writable stream to `<outputDir>/console.log` for persisting the
 * spawned eval process's combined stdout/stderr. Returns `undefined` when the
 * directory cannot be created or the file cannot be opened — callers fall back
 * to the in-memory buffer in that case.
 *
 * The log file is the source of truth shown by the RunDetail "Run Log"
 * section after the run completes. The in-memory `stdout`/`stderr` buffers on
 * `DashboardRun` remain capped for live status polling.
 *
 * Stream `error` events (e.g. the output dir was removed underneath us by a
 * test teardown) are swallowed so they don't surface as unhandled errors and
 * fail unrelated tests.
 */
function openConsoleLogStream(outputDir: string): WriteStream | undefined {
  try {
    mkdirSync(outputDir, { recursive: true });
    const stream = createWriteStream(path.join(outputDir, 'console.log'), { flags: 'w' });
    stream.on('error', () => {
      /* best-effort log capture; ignore filesystem errors */
    });
    return stream;
  } catch {
    return undefined;
  }
}

function writeInitialRunTags(outputDir: string, tags: readonly string[]): void {
  if (tags.length === 0) return;
  mkdirSync(outputDir, { recursive: true });
  writeRunTags(path.join(outputDir, 'index.jsonl'), tags);
}

// ── Route registration ───────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Hono Context generic varies by route
type C = Context<any, any, any>;

export function registerEvalRoutes(
  app: Hono,
  getCwd: (c: C) => string,
  options?: { readOnly?: boolean },
) {
  const readOnly = options?.readOnly === true;
  // ── Discovery: eval files ──────────────────────────────────────────────
  app.get('/api/eval/discover', async (c) => {
    const cwd = getCwd(c);
    try {
      const files = await discoverEvalFiles(cwd);
      return c.json({
        eval_files: files.map((f) => ({
          path: f.path,
          relative_path: f.relativePath,
          category: f.category,
        })),
      });
    } catch (err) {
      return c.json({ error: (err as Error).message, eval_files: [] }, 500);
    }
  });

  // ── Discovery: targets ─────────────────────────────────────────────────
  app.get('/api/eval/targets', async (c) => {
    const cwd = getCwd(c);
    try {
      const names = await discoverTargetsInProject(cwd);
      return c.json({ targets: names });
    } catch (err) {
      return c.json({ error: (err as Error).message, targets: [] }, 500);
    }
  });

  // ── Launch eval run ────────────────────────────────────────────────────
  app.post('/api/eval/run', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    const cwd = getCwd(c);

    let body: RunEvalRequest;
    try {
      body = await c.req.json<RunEvalRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Validate: need at least a suite filter
    if (!body.suite_filter?.trim() && (!body.test_ids || body.test_ids.length === 0)) {
      return c.json({ error: 'Provide suite_filter or test_ids' }, 400);
    }

    const resumeError = validateResumeOptions(body);
    if (resumeError) {
      return c.json({ error: resumeError }, 400);
    }

    let metadata: { experiment: string; tags: string[] };
    try {
      metadata = normalizeRunMetadata(body);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const cliPaths = resolveCliPath(cwd);
    if (!cliPaths) {
      return c.json({ error: 'Cannot locate agentv CLI entry point' }, 500);
    }

    const args = buildCliArgs(body, metadata.experiment);
    // Determine the output directory for this run. When the caller provides
    // an explicit --output (resume/rerun), use that path. Otherwise generate
    // the default path now so we can pass it via --output and later correlate
    // the filesystem run with this in-memory DashboardRun (needed to show the
    // target in the sidebar before any results have been written).
    const outputDir = body.output?.trim()
      ? path.resolve(cwd, body.output.trim())
      : buildDefaultRunDir(cwd, metadata.experiment);
    if (!body.output?.trim()) {
      args.push('--output', outputDir);
    }
    const command = buildCliPreview(args);
    const runId = generateRunId();

    const run: DashboardRun = {
      id: runId,
      status: 'starting',
      command,
      target: body.target?.trim() || undefined,
      outputDir,
      startedAt: new Date().toISOString(),
      stdout: '',
      stderr: '',
    };
    activeRuns.set(runId, run);

    try {
      writeInitialRunTags(outputDir, metadata.tags);
      const child = spawn(cliPaths.binPath, [...cliPaths.args, ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        // Windows requires shell:true to execute .cmd/.bat wrappers (e.g. npm-installed agentv.cmd)
        shell: process.platform === 'win32',
      });

      run.process = child;
      run.status = 'running';

      const logStream = openConsoleLogStream(outputDir);

      child.stdout?.on('data', (chunk: Buffer) => {
        logStream?.write(chunk);
        run.stdout += chunk.toString();
        // Cap buffer at 100KB
        if (run.stdout.length > 100_000) {
          run.stdout = run.stdout.slice(-80_000);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        logStream?.write(chunk);
        run.stderr += chunk.toString();
        if (run.stderr.length > 100_000) {
          run.stderr = run.stderr.slice(-80_000);
        }
      });

      child.on('close', (code) => {
        run.exitCode = code;
        run.status = code === 0 ? 'finished' : 'failed';
        run.finishedAt = new Date().toISOString();
        run.process = undefined;
        logStream?.end();
        pruneFinishedRuns();
      });

      child.on('error', (err) => {
        run.status = 'failed';
        run.stderr += `\nProcess error: ${err.message}`;
        run.finishedAt = new Date().toISOString();
        run.process = undefined;
        logStream?.write(`\nProcess error: ${err.message}\n`);
        logStream?.end();
      });

      return c.json(
        {
          id: runId,
          status: run.status,
          command,
        },
        202,
      );
    } catch (err) {
      run.status = 'failed';
      run.stderr = (err as Error).message;
      run.finishedAt = new Date().toISOString();
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // ── Stop a running eval ────────────────────────────────────────────────
  // POST (not DELETE) because Stop is part of the stop → resume → complete
  // workflow, not a destructive cancel. The run remains resumable from the
  // partial index.jsonl on disk. Idempotent: hitting /stop on a terminal
  // run returns 200 with `stopped: false, reason: 'already_terminal'`
  // rather than 4xx, so clients can fire-and-forget.
  //
  // SIGTERM the spawned CLI; the existing child.on('close') flips status
  // to 'finished'/'failed'. The CLI's own signal handler walks its tracked
  // grandchildren (claude/codex/pi/copilot subprocesses) and kills them
  // before exiting.
  app.post('/api/eval/run/:id/stop', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    const id = c.req.param('id');
    const run = activeRuns.get(id ?? '');
    if (!run) return c.json({ error: 'Run not found' }, 404);
    if (run.status === 'finished' || run.status === 'failed' || !run.process) {
      return c.json({ stopped: false, reason: 'already_terminal', status: run.status });
    }
    try {
      run.process.kill('SIGTERM');
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
    return c.json({ stopped: true, status: run.status });
  });

  // ── Run status ─────────────────────────────────────────────────────────
  app.get('/api/eval/status/:id', (c) => {
    const id = c.req.param('id');
    const run = activeRuns.get(id ?? '');
    if (!run) return c.json({ error: 'Run not found' }, 404);

    return c.json({
      id: run.id,
      status: run.status,
      command: run.command,
      started_at: run.startedAt,
      finished_at: run.finishedAt ?? null,
      exit_code: run.exitCode ?? null,
      stdout: run.stdout.slice(-10_000),
      stderr: run.stderr.slice(-5_000),
    });
  });

  // ── List runs ──────────────────────────────────────────────────────────
  app.get('/api/eval/runs', (c) => {
    const runs = [...activeRuns.values()].map((r) => ({
      id: r.id,
      status: r.status,
      command: r.command,
      target: r.target,
      started_at: r.startedAt,
      finished_at: r.finishedAt ?? null,
      exit_code: r.exitCode ?? null,
    }));
    runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
    return c.json({ runs });
  });

  // ── CLI preview (dry endpoint) ─────────────────────────────────────────
  app.post('/api/eval/preview', async (c) => {
    let body: RunEvalRequest;
    try {
      body = await c.req.json<RunEvalRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    let metadata: { experiment: string; tags: string[] };
    try {
      metadata = normalizeRunMetadata(body);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const args = buildCliArgs(body, metadata.experiment);
    return c.json({ command: buildCliPreview(args) });
  });

  // ── Project-scoped variants ────────────────────────────────────────────
  app.get('/api/projects/:projectId/eval/discover', async (c) => {
    const cwd = getCwd(c);
    try {
      const files = await discoverEvalFiles(cwd);
      return c.json({
        eval_files: files.map((f) => ({
          path: f.path,
          relative_path: f.relativePath,
          category: f.category,
        })),
      });
    } catch (err) {
      return c.json({ error: (err as Error).message, eval_files: [] }, 500);
    }
  });

  app.get('/api/projects/:projectId/eval/targets', async (c) => {
    const cwd = getCwd(c);
    try {
      const names = await discoverTargetsInProject(cwd);
      return c.json({ targets: names });
    } catch (err) {
      return c.json({ error: (err as Error).message, targets: [] }, 500);
    }
  });

  app.post('/api/projects/:projectId/eval/run', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    const cwd = getCwd(c);

    let body: RunEvalRequest;
    try {
      body = await c.req.json<RunEvalRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.suite_filter?.trim() && (!body.test_ids || body.test_ids.length === 0)) {
      return c.json({ error: 'Provide suite_filter or test_ids' }, 400);
    }

    const resumeError = validateResumeOptions(body);
    if (resumeError) {
      return c.json({ error: resumeError }, 400);
    }

    let metadata: { experiment: string; tags: string[] };
    try {
      metadata = normalizeRunMetadata(body);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const cliPaths = resolveCliPath(cwd);
    if (!cliPaths) {
      return c.json({ error: 'Cannot locate agentv CLI entry point' }, 500);
    }

    const args = buildCliArgs(body, metadata.experiment);
    const outputDir = body.output?.trim()
      ? path.resolve(cwd, body.output.trim())
      : buildDefaultRunDir(cwd, metadata.experiment);
    if (!body.output?.trim()) {
      args.push('--output', outputDir);
    }
    const command = buildCliPreview(args);
    const runId = generateRunId();

    const run: DashboardRun = {
      id: runId,
      status: 'starting',
      command,
      target: body.target?.trim() || undefined,
      outputDir,
      startedAt: new Date().toISOString(),
      stdout: '',
      stderr: '',
    };
    activeRuns.set(runId, run);

    try {
      writeInitialRunTags(outputDir, metadata.tags);
      const child = spawn(cliPaths.binPath, [...cliPaths.args, ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        shell: process.platform === 'win32',
      });

      run.process = child;
      run.status = 'running';

      const logStream = openConsoleLogStream(outputDir);

      child.stdout?.on('data', (chunk: Buffer) => {
        logStream?.write(chunk);
        run.stdout += chunk.toString();
        if (run.stdout.length > 100_000) run.stdout = run.stdout.slice(-80_000);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        logStream?.write(chunk);
        run.stderr += chunk.toString();
        if (run.stderr.length > 100_000) run.stderr = run.stderr.slice(-80_000);
      });
      child.on('close', (code) => {
        run.exitCode = code;
        run.status = code === 0 ? 'finished' : 'failed';
        run.finishedAt = new Date().toISOString();
        run.process = undefined;
        logStream?.end();
        pruneFinishedRuns();
      });
      child.on('error', (err) => {
        run.status = 'failed';
        run.stderr += `\nProcess error: ${err.message}`;
        run.finishedAt = new Date().toISOString();
        run.process = undefined;
        logStream?.write(`\nProcess error: ${err.message}\n`);
        logStream?.end();
      });

      return c.json({ id: runId, status: run.status, command }, 202);
    } catch (err) {
      run.status = 'failed';
      run.stderr = (err as Error).message;
      run.finishedAt = new Date().toISOString();
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/api/projects/:projectId/eval/run/:id/stop', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    const id = c.req.param('id');
    const run = activeRuns.get(id ?? '');
    if (!run) return c.json({ error: 'Run not found' }, 404);
    if (run.status === 'finished' || run.status === 'failed' || !run.process) {
      return c.json({ stopped: false, reason: 'already_terminal', status: run.status });
    }
    try {
      run.process.kill('SIGTERM');
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
    return c.json({ stopped: true, status: run.status });
  });

  app.get('/api/projects/:projectId/eval/status/:id', (c) => {
    const id = c.req.param('id');
    const run = activeRuns.get(id ?? '');
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json({
      id: run.id,
      status: run.status,
      command: run.command,
      started_at: run.startedAt,
      finished_at: run.finishedAt ?? null,
      exit_code: run.exitCode ?? null,
      stdout: run.stdout.slice(-10_000),
      stderr: run.stderr.slice(-5_000),
    });
  });

  app.get('/api/projects/:projectId/eval/runs', (c) => {
    const runs = [...activeRuns.values()].map((r) => ({
      id: r.id,
      status: r.status,
      command: r.command,
      target: r.target,
      started_at: r.startedAt,
      finished_at: r.finishedAt ?? null,
      exit_code: r.exitCode ?? null,
    }));
    runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
    return c.json({ runs });
  });

  app.post('/api/projects/:projectId/eval/preview', async (c) => {
    let body: RunEvalRequest;
    try {
      body = await c.req.json<RunEvalRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    let metadata: { experiment: string; tags: string[] };
    try {
      metadata = normalizeRunMetadata(body);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    const args = buildCliArgs(body, metadata.experiment);
    return c.json({ command: buildCliPreview(args) });
  });
}
