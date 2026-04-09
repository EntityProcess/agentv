/**
 * Benchmark registry for AgentV Studio multi-benchmark support.
 *
 * A Benchmark = any directory containing a `.agentv/` folder.
 * The registry lives at `~/.agentv/projects.yaml` and tracks registered benchmarks.
 *
 * YAML format:
 *   benchmarks:
 *     - id: my-app
 *       name: My App
 *       path: /home/user/projects/my-app
 *       addedAt: "2026-03-20T10:00:00Z"
 *       lastOpenedAt: "2026-03-30T14:00:00Z"
 *
 * To extend: use loadBenchmarkRegistry() / saveBenchmarkRegistry() for CRUD,
 * discoverBenchmarks() to scan a directory tree for `.agentv/` directories.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { getAgentvHome } from './paths.js';

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
  return path.join(getAgentvHome(), 'projects.yaml');
}

// ── Load / Save ─────────────────────────────────────────────────────────

export function loadBenchmarkRegistry(): BenchmarkRegistry {
  const registryPath = getBenchmarksRegistryPath();
  if (!existsSync(registryPath)) {
    return { benchmarks: [] };
  }
  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const parsed = parseYaml(raw);
    if (!parsed || !Array.isArray(parsed.benchmarks)) {
      return { benchmarks: [] };
    }
    return { benchmarks: parsed.benchmarks as BenchmarkEntry[] };
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
  writeFileSync(registryPath, stringifyYaml({ benchmarks: registry.benchmarks }), 'utf-8');
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

// ── Discovery ───────────────────────────────────────────────────────────

/**
 * Scan a directory tree (up to maxDepth levels) for directories containing `.agentv/`.
 * Returns absolute paths of discovered benchmark directories.
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
  return results;
}
