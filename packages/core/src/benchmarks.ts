/**
 * Benchmark registry for AgentV Studio multi-benchmark support.
 *
 * A Benchmark = any directory containing a `.agentv/` folder.
 * The registry lives at `~/.agentv/benchmarks.yaml` and is the single source of
 * truth for which benchmarks Studio shows. Studio re-reads the file on every
 * `/api/benchmarks` request, so edits (direct, via POST /api/benchmarks, via
 * the CLI's --add/--remove, or via a Kubernetes ConfigMap mount) are reflected
 * without restarting `agentv serve`.
 *
 * YAML format (all keys snake_case per AGENTS.md §"Wire Format Convention"):
 *   benchmarks:
 *     - id: my-app
 *       name: My App
 *       path: /home/user/projects/my-app
 *       added_at: "2026-03-20T10:00:00Z"
 *       last_opened_at: "2026-03-30T14:00:00Z"
 *
 * Concurrency: the registry assumes a single writer. All mutating calls
 * (add/remove/touchBenchmark) do read-modify-write on benchmarks.yaml
 * without a lock. Studio's HTTP handlers are serialized by Node's
 * single-threaded event loop, which satisfies the 24/7 deployment case.
 * Run only one `agentv` process against a given home at a time.
 *
 * To extend:
 *   - CRUD: loadBenchmarkRegistry() / saveBenchmarkRegistry() + the
 *     add/remove/touch helpers.
 *   - discoverBenchmarks() is a one-shot filesystem utility for bulk
 *     registration; it does not run in the request path.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { getAgentvConfigDir } from './paths.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface BenchmarkEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

export interface BenchmarkRegistry {
  benchmarks: BenchmarkEntry[];
}

// ── Registry path ───────────────────────────────────────────────────────

export function getBenchmarksRegistryPath(): string {
  return path.join(getAgentvConfigDir(), 'benchmarks.yaml');
}

// ── Load / Save ─────────────────────────────────────────────────────────
// YAML uses snake_case per AGENTS.md §"Wire Format Convention"; TypeScript
// internals stay camelCase. fromYaml / toYaml handle the translation; every
// other function in this module works in camelCase only.

interface BenchmarkEntryYaml {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
}

function fromYaml(raw: unknown): BenchmarkEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<BenchmarkEntryYaml>;
  if (typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.path !== 'string') {
    return null;
  }
  return {
    id: e.id,
    name: e.name,
    path: e.path,
    addedAt: typeof e.added_at === 'string' ? e.added_at : '',
    lastOpenedAt: typeof e.last_opened_at === 'string' ? e.last_opened_at : '',
  };
}

function toYaml(entry: BenchmarkEntry): BenchmarkEntryYaml {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    added_at: entry.addedAt,
    last_opened_at: entry.lastOpenedAt,
  };
}

export function loadBenchmarkRegistry(): BenchmarkRegistry {
  const registryPath = getBenchmarksRegistryPath();
  if (!existsSync(registryPath)) {
    return { benchmarks: [] };
  }
  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { benchmarks: [] };
    }
    const benchmarks = Array.isArray(parsed.benchmarks)
      ? (parsed.benchmarks as unknown[])
          .map(fromYaml)
          .filter((e): e is BenchmarkEntry => e !== null)
      : [];
    return { benchmarks };
  } catch {
    return { benchmarks: [] };
  }
}

export function saveBenchmarkRegistry(registry: BenchmarkRegistry): void {
  const registryPath = getBenchmarksRegistryPath();
  const dir = path.dirname(registryPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload = { benchmarks: registry.benchmarks.map(toYaml) };
  writeFileSync(registryPath, stringifyYaml(payload), 'utf-8');
}

// ── CRUD operations ─────────────────────────────────────────────────────

/**
 * Derive a URL-safe benchmark ID from a directory path.
 * Uses the directory basename, lowercased, with non-alphanumeric chars replaced by hyphens.
 * Appends a numeric suffix if the ID already exists in the registry.
 */
export function deriveBenchmarkId(dirPath: string, existingIds: string[]): string {
  const base = path
    .basename(dirPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  let candidate = base || 'benchmark';
  let suffix = 2;
  while (existingIds.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  return candidate;
}

/**
 * Register a benchmark by path. Returns the new entry, or the existing one if already registered.
 * Validates that the path exists and contains a `.agentv/` directory.
 */
export function addBenchmark(benchmarkPath: string): BenchmarkEntry {
  const absPath = path.resolve(benchmarkPath);
  if (!existsSync(absPath)) {
    throw new Error(`Directory not found: ${absPath}`);
  }
  if (!existsSync(path.join(absPath, '.agentv'))) {
    throw new Error(`No .agentv/ directory found in ${absPath}. Run an evaluation first.`);
  }

  const registry = loadBenchmarkRegistry();
  const existing = registry.benchmarks.find((p) => p.path === absPath);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const entry: BenchmarkEntry = {
    id: deriveBenchmarkId(
      absPath,
      registry.benchmarks.map((p) => p.id),
    ),
    name: path.basename(absPath),
    path: absPath,
    addedAt: now,
    lastOpenedAt: now,
  };
  registry.benchmarks.push(entry);
  saveBenchmarkRegistry(registry);
  return entry;
}

/**
 * Remove a benchmark by ID. Returns true if removed, false if not found.
 */
export function removeBenchmark(benchmarkId: string): boolean {
  const registry = loadBenchmarkRegistry();
  const idx = registry.benchmarks.findIndex((p) => p.id === benchmarkId);
  if (idx < 0) return false;
  registry.benchmarks.splice(idx, 1);
  saveBenchmarkRegistry(registry);
  return true;
}

/**
 * Look up a benchmark by ID. Returns undefined if not found.
 */
export function getBenchmark(benchmarkId: string): BenchmarkEntry | undefined {
  return loadBenchmarkRegistry().benchmarks.find((p) => p.id === benchmarkId);
}

/**
 * Update lastOpenedAt for a benchmark.
 */
export function touchBenchmark(benchmarkId: string): void {
  const registry = loadBenchmarkRegistry();
  const entry = registry.benchmarks.find((p) => p.id === benchmarkId);
  if (entry) {
    entry.lastOpenedAt = new Date().toISOString();
    saveBenchmarkRegistry(registry);
  }
}

// ── Discovery utility ───────────────────────────────────────────────────

/**
 * Scan a directory tree (up to maxDepth levels) for directories containing `.agentv/`.
 * Returns absolute paths of discovered benchmark directories, sorted for
 * deterministic iteration. This is a one-shot helper for bulk registration;
 * Studio does not scan at request time.
 */
export function discoverBenchmarks(rootDir: string, maxDepth = 2): string[] {
  const absRoot = path.resolve(rootDir);
  if (!existsSync(absRoot) || !statSync(absRoot).isDirectory()) {
    return [];
  }

  const results: string[] = [];

  function scan(dir: string, depth: number) {
    if (depth > maxDepth) return;

    // Check if this directory itself is a benchmark
    if (existsSync(path.join(dir, '.agentv'))) {
      results.push(dir);
      return; // Don't scan subdirectories of a benchmark
    }

    if (depth === maxDepth) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        scan(path.join(dir, entry.name), depth + 1);
      }
    } catch {
      // Permission denied or other FS errors — skip
    }
  }

  scan(absRoot, 0);
  return results.sort();
}
