/**
 * Benchmark registry for AgentV Studio multi-benchmark support.
 *
 * A Benchmark = any directory containing a `.agentv/` folder.
 * The registry lives at `~/.agentv/benchmarks.yaml` and tracks registered
 * benchmarks plus an optional list of discovery roots that Studio continuously
 * rescans at runtime so repos can appear/disappear without a server restart.
 *
 * YAML format (all keys snake_case per AGENTS.md §"Wire Format Convention"):
 *   benchmarks:
 *     - id: my-app
 *       name: My App
 *       path: /home/user/projects/my-app
 *       added_at: "2026-03-20T10:00:00Z"
 *       last_opened_at: "2026-03-30T14:00:00Z"
 *   discovery_roots:
 *     - /home/user/agentv-repos
 *   excluded_paths:                  # discovered repos to hide from Studio
 *     - /home/user/agentv-repos/experiment-v0
 *
 * Runtime model:
 *   - Entries in `benchmarks` are persisted (manual add/remove).
 *   - Entries under `discoveryRoots` are resolved live on each call to
 *     `resolveActiveBenchmarks()` — they are NOT written to disk. This means
 *     a repo appearing or disappearing under a root is reflected immediately,
 *     and manual entries are never auto-removed.
 *
 * Concurrency: the registry assumes a single writer. All mutating calls
 * (add/remove/touchBenchmark, add/removeDiscoveryRoot) do read-modify-write on
 * benchmarks.yaml without a lock. Interleaved writes from multiple processes
 * can clobber each other; Studio's HTTP handlers are serialized by Node's
 * single-threaded event loop, which satisfies the 24/7 Studio case. Run only
 * one `agentv` process against a given home at a time.
 *
 * To extend:
 *   - For CRUD on persisted entries: loadBenchmarkRegistry() / saveBenchmarkRegistry().
 *   - For live discovery: addDiscoveryRoot() / removeDiscoveryRoot() /
 *     resolveActiveBenchmarks().
 *   - discoverBenchmarks() scans a single directory tree for `.agentv/` folders;
 *     its output is sorted for deterministic id assignment under basename collisions.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { getAgentvConfigDir } from './paths.js';

// ── Types ───────────────────────────────────────────────────────────────

export type BenchmarkSource = 'manual' | 'discovered';

export interface BenchmarkEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  /** How this entry was registered. Absent (undefined) ≡ 'manual'. */
  source?: BenchmarkSource;
}

export interface BenchmarkRegistry {
  benchmarks: BenchmarkEntry[];
  /** Directories continuously rescanned for `.agentv/` repos. Optional. */
  discoveryRoots?: string[];
  /**
   * Absolute paths to exclude from the discovered set. Clicking "Remove" on a
   * discovered entry in Studio adds its path here so the repo stays on disk
   * but disappears from the UI. Has no effect on manually-pinned entries.
   */
  excludedPaths?: string[];
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
  source?: BenchmarkSource;
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
    ...(e.source && { source: e.source }),
  };
}

function toYaml(entry: BenchmarkEntry): BenchmarkEntryYaml {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    added_at: entry.addedAt,
    last_opened_at: entry.lastOpenedAt,
    ...(entry.source && { source: entry.source }),
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
    const discoveryRoots = Array.isArray(parsed.discovery_roots)
      ? (parsed.discovery_roots as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined;
    const excludedPaths = Array.isArray(parsed.excluded_paths)
      ? (parsed.excluded_paths as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined;
    const result: BenchmarkRegistry = { benchmarks };
    if (discoveryRoots !== undefined) result.discoveryRoots = discoveryRoots;
    if (excludedPaths !== undefined) result.excludedPaths = excludedPaths;
    return result;
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
  // Omit empty/undefined optional lists from the serialized form so registries
  // without the feature don't grow stray keys.
  const payload: Record<string, unknown> = {
    benchmarks: registry.benchmarks.map(toYaml),
  };
  if (registry.discoveryRoots && registry.discoveryRoots.length > 0) {
    payload.discovery_roots = registry.discoveryRoots;
  }
  if (registry.excludedPaths && registry.excludedPaths.length > 0) {
    payload.excluded_paths = registry.excludedPaths;
  }
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
  // Pinning overrides a prior exclusion: if the user explicitly adds a path
  // they had previously hidden from discovery, they clearly want to see it.
  if (registry.excludedPaths?.includes(absPath)) {
    registry.excludedPaths = registry.excludedPaths.filter((p) => p !== absPath);
  }
  const existing = registry.benchmarks.find((p) => p.path === absPath);
  if (existing) {
    saveBenchmarkRegistry(registry);
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
  // Sort for deterministic iteration — readdirSync order is filesystem-dependent,
  // and basename collisions produce collision-suffix ids that must be stable.
  return results.sort();
}

// ── Discovery roots (persisted) ─────────────────────────────────────────

/**
 * Return the persisted discovery roots as absolute paths. Never returns undefined.
 */
export function getDiscoveryRoots(): string[] {
  const registry = loadBenchmarkRegistry();
  return [...(registry.discoveryRoots ?? [])];
}

/**
 * Add an absolute discovery root to the persisted registry (idempotent).
 * Returns the resolved absolute path. Does NOT validate that the directory
 * currently exists — a root may become populated after Studio starts.
 */
export function addDiscoveryRoot(rootPath: string): string {
  const absRoot = path.resolve(rootPath);
  const registry = loadBenchmarkRegistry();
  const roots = registry.discoveryRoots ?? [];
  if (!roots.includes(absRoot)) {
    roots.push(absRoot);
  }
  registry.discoveryRoots = roots;
  saveBenchmarkRegistry(registry);
  return absRoot;
}

/**
 * Remove a discovery root. Returns true if it was present, false otherwise.
 */
export function removeDiscoveryRoot(rootPath: string): boolean {
  const absRoot = path.resolve(rootPath);
  const registry = loadBenchmarkRegistry();
  const roots = registry.discoveryRoots ?? [];
  const idx = roots.indexOf(absRoot);
  if (idx < 0) return false;
  roots.splice(idx, 1);
  registry.discoveryRoots = roots;
  saveBenchmarkRegistry(registry);
  return true;
}

// ── Exclusions (hide a discovered repo without deleting its .agentv/) ──

/**
 * Return the persisted exclusion list as absolute paths.
 */
export function getExcludedPaths(): string[] {
  return [...(loadBenchmarkRegistry().excludedPaths ?? [])];
}

/**
 * Append a path to the exclusion list (idempotent). Used when the user
 * clicks "Remove" on a discovered entry — the .agentv/ dir stays on disk,
 * but it's suppressed from the active set until the user unexcludes it.
 * Returns the resolved absolute path.
 */
export function addExcludedPath(excludePath: string): string {
  const abs = path.resolve(excludePath);
  const registry = loadBenchmarkRegistry();
  const excluded = registry.excludedPaths ?? [];
  if (!excluded.includes(abs)) {
    excluded.push(abs);
  }
  registry.excludedPaths = excluded;
  saveBenchmarkRegistry(registry);
  return abs;
}

/**
 * Remove a path from the exclusion list. Returns true if it was present.
 * The repo will reappear on the next discovery rescan if still under a root.
 */
export function removeExcludedPath(excludePath: string): boolean {
  const abs = path.resolve(excludePath);
  const registry = loadBenchmarkRegistry();
  const excluded = registry.excludedPaths ?? [];
  const idx = excluded.indexOf(abs);
  if (idx < 0) return false;
  excluded.splice(idx, 1);
  registry.excludedPaths = excluded;
  saveBenchmarkRegistry(registry);
  return true;
}

// ── Active benchmarks (persisted + live-discovered) ─────────────────────

/**
 * Return the effective benchmark list: persisted entries merged with a live
 * scan of every discovery root. Discovered entries are synthesized on the fly
 * (tagged `source: 'discovered'`) and are NOT written to disk, so a repo
 * disappearing from a root drops out of subsequent calls. Persisted entries
 * win on absolute-path conflict, letting a user opt a discovered repo into
 * manual management. Paths in `excludedPaths` are filtered out of the
 * discovered set (but never from pinned entries).
 */
export function resolveActiveBenchmarks(): BenchmarkEntry[] {
  const registry = loadBenchmarkRegistry();
  const persisted = registry.benchmarks.map((b) => ({
    ...b,
    source: b.source ?? ('manual' as const),
  }));
  const roots = registry.discoveryRoots ?? [];
  if (roots.length === 0) return persisted;

  const excluded = new Set(registry.excludedPaths ?? []);
  const takenPaths = new Set(persisted.map((b) => b.path));
  const takenIds = new Set(persisted.map((b) => b.id));
  const discovered: BenchmarkEntry[] = [];
  for (const root of roots) {
    for (const repoPath of discoverBenchmarks(root)) {
      if (takenPaths.has(repoPath)) continue;
      if (excluded.has(repoPath)) continue;
      takenPaths.add(repoPath);
      const id = deriveBenchmarkId(repoPath, [...takenIds]);
      takenIds.add(id);
      // Synthetic timestamps: use the .agentv dir mtime if readable, else now.
      let ts = new Date().toISOString();
      try {
        ts = statSync(path.join(repoPath, '.agentv')).mtime.toISOString();
      } catch {
        // Keep the fallback timestamp.
      }
      discovered.push({
        id,
        name: path.basename(repoPath),
        path: repoPath,
        addedAt: ts,
        lastOpenedAt: ts,
        source: 'discovered',
      });
    }
  }
  return [...persisted, ...discovered];
}

/**
 * Look up an active benchmark (persisted or discovered) by id.
 */
export function getActiveBenchmark(benchmarkId: string): BenchmarkEntry | undefined {
  return resolveActiveBenchmarks().find((b) => b.id === benchmarkId);
}
