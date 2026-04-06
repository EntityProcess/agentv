/**
 * Studio eval runner — discovery, launch, and status tracking for eval runs
 * initiated from the Studio UI.
 *
 * Provides Hono route handlers for:
 *   - GET  /api/eval/discover  — discover eval files in the project
 *   - GET  /api/eval/targets   — list available target names
 *   - POST /api/eval/run       — launch an eval run as a child process
 *   - GET  /api/eval/status/:id — poll running eval status
 *   - GET  /api/eval/runs      — list active and recent Studio-launched runs
 *
 * All handlers accept a `cwd` (project root) to resolve paths against.
 * The module spawns `bun apps/cli/src/cli.ts eval run ...` and tracks
 * process state in memory.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { listTargetNames, readTargetDefinitions } from '@agentv/core';
import type { Context } from 'hono';
import type { Hono } from 'hono';

import { TARGET_FILE_CANDIDATES, discoverTargetsFile } from '../../utils/targets.js';
import { discoverEvalFiles } from '../eval/discover.js';
import { findRepoRoot } from '../eval/shared.js';

// ── In-memory run tracker ────────────────────────────────────────────────

interface StudioRun {
  id: string;
  status: 'starting' | 'running' | 'finished' | 'failed';
  command: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  process?: ChildProcess;
}

const activeRuns = new Map<string, StudioRun>();

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `studio-${ts}-${rand}`;
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
  threshold?: number;
  workers?: number;
  dry_run?: boolean;
}

function buildCliArgs(req: RunEvalRequest): string[] {
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

  return args;
}

function buildCliPreview(args: string[]): string {
  return `agentv ${args.map((a) => (a.includes(' ') || a.includes('*') ? `"${a}"` : a)).join(' ')}`;
}

// ── Resolve the bun + cli.ts path ────────────────────────────────────────

function resolveCliPath(cwd: string): { bunPath: string; cliPath: string } | undefined {
  // Try to find cli.ts in the project (monorepo dev context)
  const candidates = [
    path.join(cwd, 'apps/cli/src/cli.ts'),
    path.join(cwd, 'apps/cli/dist/cli.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return { bunPath: 'bun', cliPath: c };
    }
  }

  // Try from the current running process location
  const currentDir =
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(new URL(import.meta.url).pathname);
  const fromSrc = path.resolve(currentDir, '../../../cli.ts');
  const fromDist = path.resolve(currentDir, '../../cli.js');

  if (existsSync(fromSrc)) return { bunPath: 'bun', cliPath: fromSrc };
  if (existsSync(fromDist)) return { bunPath: 'bun', cliPath: fromDist };

  return undefined;
}

// ── Route registration ───────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Hono Context generic varies by route
type C = Context<any, any, any>;

export function registerEvalRoutes(app: Hono, getCwd: (c: C) => string) {
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

    const cliPaths = resolveCliPath(cwd);
    if (!cliPaths) {
      return c.json({ error: 'Cannot locate agentv CLI entry point' }, 500);
    }

    const args = buildCliArgs(body);
    const command = buildCliPreview(args);
    const runId = generateRunId();

    const run: StudioRun = {
      id: runId,
      status: 'starting',
      command,
      startedAt: new Date().toISOString(),
      stdout: '',
      stderr: '',
    };
    activeRuns.set(runId, run);

    try {
      const child = spawn(cliPaths.bunPath, [cliPaths.cliPath, ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      run.process = child;
      run.status = 'running';

      child.stdout?.on('data', (chunk: Buffer) => {
        run.stdout += chunk.toString();
        // Cap buffer at 100KB
        if (run.stdout.length > 100_000) {
          run.stdout = run.stdout.slice(-80_000);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
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
        pruneFinishedRuns();
      });

      child.on('error', (err) => {
        run.status = 'failed';
        run.stderr += `\nProcess error: ${err.message}`;
        run.finishedAt = new Date().toISOString();
        run.process = undefined;
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

    const args = buildCliArgs(body);
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

    const cliPaths = resolveCliPath(cwd);
    if (!cliPaths) {
      return c.json({ error: 'Cannot locate agentv CLI entry point' }, 500);
    }

    const args = buildCliArgs(body);
    const command = buildCliPreview(args);
    const runId = generateRunId();

    const run: StudioRun = {
      id: runId,
      status: 'starting',
      command,
      startedAt: new Date().toISOString(),
      stdout: '',
      stderr: '',
    };
    activeRuns.set(runId, run);

    try {
      const child = spawn(cliPaths.bunPath, [cliPaths.cliPath, ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      run.process = child;
      run.status = 'running';

      child.stdout?.on('data', (chunk: Buffer) => {
        run.stdout += chunk.toString();
        if (run.stdout.length > 100_000) run.stdout = run.stdout.slice(-80_000);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        run.stderr += chunk.toString();
        if (run.stderr.length > 100_000) run.stderr = run.stderr.slice(-80_000);
      });
      child.on('close', (code) => {
        run.exitCode = code;
        run.status = code === 0 ? 'finished' : 'failed';
        run.finishedAt = new Date().toISOString();
        run.process = undefined;
        pruneFinishedRuns();
      });
      child.on('error', (err) => {
        run.status = 'failed';
        run.stderr += `\nProcess error: ${err.message}`;
        run.finishedAt = new Date().toISOString();
        run.process = undefined;
      });

      return c.json({ id: runId, status: run.status, command }, 202);
    } catch (err) {
      run.status = 'failed';
      run.stderr = (err as Error).message;
      run.finishedAt = new Date().toISOString();
      return c.json({ error: (err as Error).message }, 500);
    }
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
    const args = buildCliArgs(body);
    return c.json({ command: buildCliPreview(args) });
  });
}
