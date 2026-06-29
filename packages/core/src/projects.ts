/**
 * Project registry for AgentV Dashboard multi-project support.
 *
 * A Project = any directory containing a `.agentv/` folder. Projects hold
 * eval runs, and (incrementally) traces, spans, and other telemetry —
 * matching the "project" terminology used by Arize Phoenix, Langfuse,
 * Braintrust, W&B Weave, and LangSmith.
 *
 * The registry lives under `projects:` in `~/.agentv/config.yaml`, optionally
 * overlaid by `~/.agentv/config.local.yaml`, and is the single source of truth
 * for which projects Dashboard shows. Dashboard re-reads the files on every
 * `/api/projects` request, so edits (direct, via POST /api/projects, via the
 * CLI's --add/--remove, or via a Kubernetes ConfigMap mount) are reflected
 * without restarting `agentv serve`.
 *
 * YAML format (all keys snake_case per AGENTS.md §"Wire Format Convention"):
 *   projects:
 *     - id: my-app
 *       name: My App
 *       repo:
 *         url: https://github.com/example/my-app.git
 *         branch: main
 *         path: /home/user/projects/my-app
 *       results:
 *         repo:
 *           remote: https://github.com/example/my-app.git
 *           path: .
 *           branch: agentv/results/v1
 *         sync:
 *           auto_push: true
 *       added_at: "2026-03-20T10:00:00Z"
 *       last_opened_at: "2026-03-30T14:00:00Z"
 *
 * The optional `repoUrl` field enables remote sync via syncProjects():
 *   first run — git clone --depth 1 --filter=blob:none
 *   subsequent runs — git pull --ff-only
 *
 * Concurrency: the registry assumes a single writer. All mutating calls
 * (add/remove/touchProject) do read-modify-write on the owning registry file
 * without a lock, preserving unrelated top-level config keys. If
 * `config.local.yaml` already has a top-level `projects:` key, mutations stay
 * there so local-only paths and result remotes are not silently moved into
 * portable `config.yaml`. Dashboard's HTTP handlers are serialized by Node's
 * single-threaded event loop, which satisfies the 24/7 deployment case.
 * Run only one `agentv` process against a given home at a time.
 *
 * To extend:
 *   - CRUD: loadProjectRegistry() / saveProjectRegistry() + the
 *     add/remove/touch helpers.
 *   - discoverProjects() is a one-shot filesystem utility for bulk
 *     registration; it does not run in the request path.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { stringify as stringifyYaml } from 'yaml';

import {
  AGENTV_CONFIG_FILE_NAME,
  getLocalConfigPath,
  mergeConfigObjects,
} from './config-overlays.js';
import { interpolateEnv } from './evaluation/interpolation.js';
import { parseYamlValue } from './evaluation/yaml-loader.js';
import { getAgentvConfigDir } from './paths.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface ProjectResultsSyncConfig {
  autoPush?: boolean;
  pushConflictPolicy?: 'block';
}

export interface ProjectResultsConfig {
  repoUrl?: string;
  repoPath?: string;
  branch?: string;
  path?: string;
  sync?: ProjectResultsSyncConfig;
  branchPrefix?: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  repoUrl?: string;
  path: string;
  ref?: string;
  addedAt: string;
  lastOpenedAt: string;
  results?: ProjectResultsConfig;
}

export interface ProjectRegistry {
  projects: ProjectEntry[];
}

// ── Registry path ───────────────────────────────────────────────────────

export function getProjectsRegistryPath(): string {
  return path.join(getAgentvConfigDir(), AGENTV_CONFIG_FILE_NAME);
}

// ── Load / Save ─────────────────────────────────────────────────────────
// YAML uses snake_case per AGENTS.md §"Wire Format Convention"; TypeScript
// internals stay camelCase. fromYaml / toYaml handle the translation; every
// other function in this module works in camelCase only.

interface ProjectResultsSyncYaml {
  auto_push?: boolean;
  push_conflict_policy?: 'block' | string;
}

interface ProjectResultsYaml {
  repo?: ProjectResultsRepoYaml;
  repo_url?: string;
  repo_path?: string;
  branch?: string;
  remote?: string;
  path?: string;
  sync?: ProjectResultsSyncYaml;
  branch_prefix?: string;
}

interface ProjectRepoYaml {
  url?: string;
  branch?: string;
  path?: string;
}

interface ProjectResultsRepoYaml {
  url?: string;
  path?: string;
  branch?: string;
  remote?: string;
}

interface ProjectEntryYaml {
  id: string;
  name: string;
  repo?: ProjectRepoYaml;
  repo_url?: string;
  path?: string;
  ref?: string;
  added_at: string;
  last_opened_at: string;
  results?: ProjectResultsYaml;
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

let warnedRemovedBackupAndForcePushPolicy = false;
let warnedRemovedRequirePushConfig = false;
let warnedRejectedFlatResultsRemoteConfig = false;

function warnRemovedBackupAndForcePushPolicy(): void {
  if (warnedRemovedBackupAndForcePushPolicy) {
    return;
  }
  warnedRemovedBackupAndForcePushPolicy = true;
  console.warn(
    "[agentv] projects[].results.sync.push_conflict_policy: 'backup_and_force_push' is no longer supported and was ignored while loading the project registry. Remove the field or set it to 'block'; AgentV never force-pushes result branches.",
  );
}

function warnRemovedRequirePushConfig(): void {
  if (warnedRemovedRequirePushConfig) {
    return;
  }
  warnedRemovedRequirePushConfig = true;
  console.warn(
    '[agentv] projects[].results.sync.require_push is no longer supported in persistent config and was ignored while loading the project registry. Use the per-run --results-require-push CLI flag instead.',
  );
}

function warnRejectedFlatResultsRemoteConfig(): void {
  if (warnedRejectedFlatResultsRemoteConfig) {
    return;
  }
  warnedRejectedFlatResultsRemoteConfig = true;
  console.warn(
    '[agentv] projects[].results.remote is no longer supported in persistent config, so that results block was ignored while loading the project registry. Use projects[].results.repo.remote for a portable Git endpoint URL, or omit it and let AgentV use the local checkout remote alias internally.',
  );
}

function fromYaml(raw: unknown): ProjectEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<ProjectEntryYaml>;
  const repo = e.repo && typeof e.repo === 'object' ? e.repo : undefined;
  const sourcePath = readTrimmedString(repo?.path) ?? readTrimmedString(e.path);
  if (typeof e.id !== 'string' || typeof e.name !== 'string' || !sourcePath) {
    return null;
  }
  const entry: ProjectEntry = {
    id: e.id,
    name: e.name,
    path: sourcePath,
    addedAt: typeof e.added_at === 'string' ? e.added_at : '',
    lastOpenedAt: typeof e.last_opened_at === 'string' ? e.last_opened_at : '',
  };
  const repoUrl = readTrimmedString(repo?.url) ?? readTrimmedString(e.repo_url);
  if (repoUrl) {
    entry.repoUrl = repoUrl;
  }
  const branch = readTrimmedString(repo?.branch) ?? readTrimmedString(e.ref);
  if (branch) {
    entry.ref = branch;
  }
  if (e.results && typeof e.results === 'object') {
    const r = e.results as Partial<ProjectResultsYaml>;
    if (r.remote !== undefined) {
      warnRejectedFlatResultsRemoteConfig();
      return entry;
    }
    const resultsRepo =
      r.repo && typeof r.repo === 'object' && !Array.isArray(r.repo) ? r.repo : undefined;
    const repoUrl =
      readTrimmedString(resultsRepo?.remote) ??
      readTrimmedString(resultsRepo?.url) ??
      readTrimmedString(r.repo_url);
    const repoPath = repoUrl
      ? undefined
      : (readTrimmedString(resultsRepo?.path) ?? readTrimmedString(r.repo_path));
    const clonePath = repoUrl
      ? (readTrimmedString(resultsRepo?.path) ?? readTrimmedString(r.path))
      : readTrimmedString(r.path);
    const resultsBranch = readTrimmedString(resultsRepo?.branch) ?? readTrimmedString(r.branch);
    if (repoUrl || repoPath) {
      const sync = r.sync && typeof r.sync === 'object' ? r.sync : undefined;
      entry.results = {
        ...(repoUrl ? { repoUrl } : {}),
        ...(repoPath ? { repoPath } : {}),
        ...(resultsBranch ? { branch: resultsBranch } : {}),
        ...(clonePath ? { path: clonePath } : {}),
        ...(sync &&
        (typeof sync.auto_push === 'boolean' ||
          sync.push_conflict_policy === 'block' ||
          sync.push_conflict_policy === 'backup_and_force_push')
          ? {
              sync: {
                ...(typeof sync.auto_push === 'boolean' ? { autoPush: sync.auto_push } : {}),
                ...(sync.push_conflict_policy === 'block'
                  ? { pushConflictPolicy: sync.push_conflict_policy }
                  : {}),
              },
            }
          : {}),
        ...(typeof r.branch_prefix === 'string' && r.branch_prefix.trim().length > 0
          ? { branchPrefix: r.branch_prefix.trim() }
          : {}),
      };
      if (sync && 'require_push' in sync) {
        warnRemovedRequirePushConfig();
      }
      if (sync?.push_conflict_policy === 'backup_and_force_push') {
        warnRemovedBackupAndForcePushPolicy();
      }
    }
  }
  return entry;
}

function toYaml(entry: ProjectEntry): ProjectEntryYaml {
  const yaml: ProjectEntryYaml = {
    id: entry.id,
    name: entry.name,
    repo: {
      ...(entry.repoUrl !== undefined && { url: entry.repoUrl }),
      ...(entry.ref !== undefined && { branch: entry.ref }),
      path: entry.path,
    },
    added_at: entry.addedAt,
    last_opened_at: entry.lastOpenedAt,
  };
  if (entry.results) {
    const resultsSync =
      entry.results.sync?.autoPush !== undefined ||
      entry.results.sync?.pushConflictPolicy !== undefined
        ? {
            sync: {
              ...(entry.results.sync?.autoPush !== undefined && {
                auto_push: entry.results.sync.autoPush,
              }),
              ...(entry.results.sync?.pushConflictPolicy !== undefined && {
                push_conflict_policy: entry.results.sync.pushConflictPolicy,
              }),
            },
          }
        : {};
    const branchPrefix =
      entry.results.branchPrefix !== undefined ? { branch_prefix: entry.results.branchPrefix } : {};

    const resultsRepo: ProjectResultsRepoYaml = {
      ...(entry.results.repoUrl !== undefined && { remote: entry.results.repoUrl }),
      ...(entry.results.branch !== undefined && { branch: entry.results.branch }),
      ...(entry.results.repoUrl &&
        entry.results.path !== undefined && {
          path: entry.results.path,
        }),
      ...(entry.results.repoUrl === undefined &&
        entry.results.repoPath !== undefined && { path: entry.results.repoPath }),
    };
    yaml.results = {
      repo: resultsRepo,
      ...resultsSync,
      ...branchPrefix,
    };
  }
  return yaml;
}

export function loadProjectRegistry(): ProjectRegistry {
  const registryPath = getProjectsRegistryPath();
  const localRegistryPath = getLocalConfigPath(registryPath);
  if (!existsSync(registryPath) && !existsSync(localRegistryPath)) {
    return { projects: [] };
  }
  try {
    const parsed = readMergedHomeConfig(registryPath) as { projects?: unknown } | null | undefined;
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
  const registryPath = getProjectsRegistryWritePath();
  const dir = path.dirname(registryPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload = { ...readHomeConfig(registryPath), projects: registry.projects.map(toYaml) };
  writeFileSync(registryPath, stringifyYaml(payload), 'utf-8');
}

function readHomeConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  try {
    const parsed = parseYamlValue(readFileSync(configPath, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readMergedHomeConfig(configPath: string): Record<string, unknown> {
  const base = readHomeConfig(configPath);
  const local = readHomeConfig(getLocalConfigPath(configPath));
  return Object.keys(base).length > 0 && Object.keys(local).length > 0
    ? mergeConfigObjects(base, local)
    : Object.keys(local).length > 0
      ? local
      : base;
}

function getProjectsRegistryWritePath(): string {
  const registryPath = getProjectsRegistryPath();
  const localRegistryPath = getLocalConfigPath(registryPath);
  const localConfig = readHomeConfig(localRegistryPath);
  return Object.prototype.hasOwnProperty.call(localConfig, 'projects')
    ? localRegistryPath
    : registryPath;
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
 * Look up the registered project containing a filesystem path.
 * Exact path matches win; otherwise the deepest registered parent wins.
 */
export function getProjectForPath(fsPath: string): ProjectEntry | undefined {
  const absPath = path.resolve(fsPath);
  return loadProjectRegistry()
    .projects.filter((p) => {
      const projectPath = path.resolve(p.path);
      const relative = path.relative(projectPath, absPath);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    })
    .sort((a, b) => path.resolve(b.path).length - path.resolve(a.path).length)[0];
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
