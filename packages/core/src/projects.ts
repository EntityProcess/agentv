/**
 * Project registry for AgentV Dashboard multi-project support.
 *
 * A Project = any directory containing a `.agentv/` folder. Projects hold
 * eval runs, and (incrementally) traces, spans, and other telemetry —
 * matching the "project" terminology used by Arize Phoenix, Langfuse,
 * Braintrust, W&B Weave, and LangSmith.
 *
 * The registry lives at `~/.agentv/projects.yaml` and is the single source
 * of truth for which projects Dashboard shows. Dashboard re-reads the file on every
 * `/api/projects` request, so edits (direct, via POST /api/projects, via
 * the CLI's --add/--remove, or via a Kubernetes ConfigMap mount) are reflected
 * without restarting `agentv serve`.
 *
 * YAML format (all keys snake_case per AGENTS.md §"Wire Format Convention"):
 *   projects:
 *     - id: my-app
 *       name: My App
 *       path: /home/user/projects/my-app
 *       source:
 *         url: ${{ PROJECT_REPO_URL }}
 *         ref: ${{ PROJECT_REPO_REF:-main }}
 *       added_at: "2026-03-20T10:00:00Z"
 *       last_opened_at: "2026-03-30T14:00:00Z"
 *
 * The optional `source` field enables remote sync via syncProjects():
 *   first run — git clone --depth 1 --filter=blob:none
 *   subsequent runs — git pull --ff-only
 *
 * Concurrency: the registry assumes a single writer. All mutating calls
 * (add/remove/touchProject) do read-modify-write on projects.yaml
 * without a lock. Dashboard's HTTP handlers are serialized by Node's
 * single-threaded event loop, which satisfies the 24/7 deployment case.
 * Run only one `agentv` process against a given home at a time.
 *
 * Legacy registry filename: the registry used to be called `benchmarks.yaml`
 * with a top-level `benchmarks:` key. On first load, a one-time migration
 * detects the old file, rewrites the top-level key to `projects:`, and
 * atomically renames the file. See migrateLegacyBenchmarksFile() below.
 *
 * To extend:
 *   - CRUD: loadProjectRegistry() / saveProjectRegistry() + the
 *     add/remove/touch helpers.
 *   - discoverProjects() is a one-shot filesystem utility for bulk
 *     registration; it does not run in the request path.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { stringify as stringifyYaml } from 'yaml';

import { interpolateEnv } from './evaluation/interpolation.js';
import { parseYamlValue } from './evaluation/yaml-loader.js';
import { getAgentvConfigDir } from './paths.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface ProjectSource {
  url: string;
  ref: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  source?: ProjectSource;
}

export interface ProjectRegistry {
  projects: ProjectEntry[];
}

// ── Registry path ───────────────────────────────────────────────────────

export function getProjectsRegistryPath(): string {
  return path.join(getAgentvConfigDir(), 'projects.yaml');
}

/** Legacy registry path, kept private — only the migration helper reads it. */
function getLegacyBenchmarksRegistryPath(): string {
  return path.join(getAgentvConfigDir(), 'benchmarks.yaml');
}

// ── Legacy file migration ───────────────────────────────────────────────
// One-time, idempotent. Called at the top of loadProjectRegistry() so any
// entry point (CLI, Dashboard server, tests) picks the new file up transparently.
//
// Rules:
//   - projects.yaml exists, benchmarks.yaml missing → no-op (already migrated).
//   - benchmarks.yaml exists, projects.yaml missing → migrate: read → rewrite
//     top-level key benchmarks: → projects: → atomic rename temp → projects.yaml,
//     then unlink benchmarks.yaml. Logs one line to stderr.
//   - both exist → projects.yaml wins; benchmarks.yaml is left alone but a
//     one-line warning goes to stderr so the operator can investigate.
//   - neither exists → no-op (fresh install).
//
// The migration only rewrites the top-level key; entry shapes are unchanged.

function migrateLegacyBenchmarksFile(): void {
  const newPath = getProjectsRegistryPath();
  const oldPath = getLegacyBenchmarksRegistryPath();
  const newExists = existsSync(newPath);
  const oldExists = existsSync(oldPath);

  if (!oldExists) return;

  if (newExists) {
    console.warn(
      `[agentv] Both ${oldPath} and ${newPath} exist. Using ${path.basename(newPath)}; ` +
        `delete ${path.basename(oldPath)} when you've confirmed the new file is correct.`,
    );
    return;
  }

  let parsed: { benchmarks?: unknown } | null = null;
  try {
    const raw = readFileSync(oldPath, 'utf-8');
    parsed = parseYamlValue(raw) as { benchmarks?: unknown } | null;
  } catch (err) {
    console.warn(
      `[agentv] Failed to read legacy ${path.basename(oldPath)} for migration: ${(err as Error).message}. Leaving the file in place; you may need to migrate it manually.`,
    );
    return;
  }

  // Rewrite top-level key only; entries themselves stay snake_case on disk.
  const entries =
    parsed && typeof parsed === 'object' && Array.isArray(parsed.benchmarks)
      ? (parsed.benchmarks as unknown[])
      : [];
  const newContent = stringifyYaml({ projects: entries });

  // Atomic temp + rename so a crash mid-write never leaves a corrupted
  // projects.yaml. Only after the rename succeeds do we unlink the old file.
  const tempPath = `${newPath}.migrating`;
  try {
    mkdirSync(path.dirname(newPath), { recursive: true });
    writeFileSync(tempPath, newContent, 'utf-8');
    renameSync(tempPath, newPath);
    unlinkSync(oldPath);
  } catch (err) {
    // Clean up the temp if rename failed.
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      /* best-effort */
    }
    console.warn(
      `[agentv] Failed to migrate ${path.basename(oldPath)} → ${path.basename(newPath)}: ` +
        `${(err as Error).message}. Legacy file left in place.`,
    );
    return;
  }

  console.log(
    `[agentv] Migrated registry: ${path.basename(oldPath)} → ${path.basename(newPath)} ` +
      `(${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`,
  );
}

// ── Load / Save ─────────────────────────────────────────────────────────
// YAML uses snake_case per AGENTS.md §"Wire Format Convention"; TypeScript
// internals stay camelCase. fromYaml / toYaml handle the translation; every
// other function in this module works in camelCase only.

interface ProjectSourceYaml {
  url: string;
  ref: string;
}

interface ProjectEntryYaml {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
  source?: ProjectSourceYaml;
}

function fromYaml(raw: unknown): ProjectEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<ProjectEntryYaml>;
  if (typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.path !== 'string') {
    return null;
  }
  const entry: ProjectEntry = {
    id: e.id,
    name: e.name,
    path: e.path,
    addedAt: typeof e.added_at === 'string' ? e.added_at : '',
    lastOpenedAt: typeof e.last_opened_at === 'string' ? e.last_opened_at : '',
  };
  if (e.source && typeof e.source === 'object') {
    const s = e.source as Partial<ProjectSourceYaml>;
    if (typeof s.url === 'string' && typeof s.ref === 'string') {
      entry.source = { url: s.url, ref: s.ref };
    }
  }
  return entry;
}

function toYaml(entry: ProjectEntry): ProjectEntryYaml {
  const yaml: ProjectEntryYaml = {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    added_at: entry.addedAt,
    last_opened_at: entry.lastOpenedAt,
  };
  if (entry.source) {
    yaml.source = { url: entry.source.url, ref: entry.source.ref };
  }
  return yaml;
}

export function loadProjectRegistry(): ProjectRegistry {
  migrateLegacyBenchmarksFile();
  const registryPath = getProjectsRegistryPath();
  if (!existsSync(registryPath)) {
    return { projects: [] };
  }
  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const parsed = parseYamlValue(raw) as { projects?: unknown } | null | undefined;
    if (!parsed || typeof parsed !== 'object') {
      return { projects: [] };
    }
    const env = process.env as Record<string, string>;
    const projects = Array.isArray(parsed.projects)
      ? (parsed.projects as unknown[])
          .map((e) => fromYaml(interpolateEnv(e, env)))
          .filter((e): e is ProjectEntry => e !== null)
      : [];
    return { projects };
  } catch {
    return { projects: [] };
  }
}

export function saveProjectRegistry(registry: ProjectRegistry): void {
  const registryPath = getProjectsRegistryPath();
  const dir = path.dirname(registryPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload = { projects: registry.projects.map(toYaml) };
  writeFileSync(registryPath, stringifyYaml(payload), 'utf-8');
}

// ── CRUD operations ─────────────────────────────────────────────────────

/**
 * Derive a URL-safe project ID from a directory path.
 * Uses the directory basename, lowercased, with non-alphanumeric chars replaced by hyphens.
 * Appends a numeric suffix if the ID already exists in the registry.
 */
export function deriveProjectId(dirPath: string, existingIds: string[]): string {
  const base = path
    .basename(dirPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  let candidate = base || 'project';
  let suffix = 2;
  while (existingIds.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  return candidate;
}

/**
 * Register a project by path. Returns the new entry, or the existing one if already registered.
 * Validates that the path exists and contains a `.agentv/` directory.
 */
export function addProject(projectPath: string): ProjectEntry {
  const absPath = path.resolve(projectPath);
  if (!existsSync(absPath)) {
    throw new Error(`Directory not found: ${absPath}`);
  }
  if (!existsSync(path.join(absPath, '.agentv'))) {
    throw new Error(`No .agentv/ directory found in ${absPath}. Run an evaluation first.`);
  }

  const registry = loadProjectRegistry();
  const existing = registry.projects.find((p) => p.path === absPath);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const entry: ProjectEntry = {
    id: deriveProjectId(
      absPath,
      registry.projects.map((p) => p.id),
    ),
    name: path.basename(absPath),
    path: absPath,
    addedAt: now,
    lastOpenedAt: now,
  };
  registry.projects.push(entry);
  saveProjectRegistry(registry);
  return entry;
}

/**
 * Remove a project by ID. Returns true if removed, false if not found.
 */
export function removeProject(projectId: string): boolean {
  const registry = loadProjectRegistry();
  const idx = registry.projects.findIndex((p) => p.id === projectId);
  if (idx < 0) return false;
  registry.projects.splice(idx, 1);
  saveProjectRegistry(registry);
  return true;
}

/**
 * Look up a project by ID. Returns undefined if not found.
 */
export function getProject(projectId: string): ProjectEntry | undefined {
  return loadProjectRegistry().projects.find((p) => p.id === projectId);
}

/**
 * Update lastOpenedAt for a project.
 */
export function touchProject(projectId: string): void {
  const registry = loadProjectRegistry();
  const entry = registry.projects.find((p) => p.id === projectId);
  if (entry) {
    entry.lastOpenedAt = new Date().toISOString();
    saveProjectRegistry(registry);
  }
}

// ── Discovery utility ───────────────────────────────────────────────────

/**
 * Scan a directory tree (up to maxDepth levels) for directories containing `.agentv/`.
 * Returns absolute paths of discovered project directories, sorted for
 * deterministic iteration. This is a one-shot helper for bulk registration;
 * Dashboard does not scan at request time.
 */
export function discoverProjects(rootDir: string, maxDepth = 2): string[] {
  const absRoot = path.resolve(rootDir);
  if (!existsSync(absRoot) || !statSync(absRoot).isDirectory()) {
    return [];
  }

  const results: string[] = [];

  function scan(dir: string, depth: number) {
    if (depth > maxDepth) return;

    // Check if this directory itself is a project
    if (existsSync(path.join(dir, '.agentv'))) {
      results.push(dir);
      return; // Don't scan subdirectories of a project
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
