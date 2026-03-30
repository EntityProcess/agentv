/**
 * Project registry for AgentV Studio multi-project support.
 *
 * A Project = any directory containing a `.agentv/` folder.
 * The registry lives at `~/.agentv/projects.yaml` and tracks registered projects.
 *
 * YAML format:
 *   projects:
 *     - id: my-app
 *       name: My App
 *       path: /home/user/projects/my-app
 *       addedAt: "2026-03-20T10:00:00Z"
 *       lastOpenedAt: "2026-03-30T14:00:00Z"
 *
 * To extend: use loadProjectRegistry() / saveProjectRegistry() for CRUD,
 * discoverProjects() to scan a directory tree for `.agentv/` directories.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { getAgentvHome } from './paths.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

export interface ProjectRegistry {
  projects: ProjectEntry[];
}

// ── Registry path ───────────────────────────────────────────────────────

export function getProjectsRegistryPath(): string {
  return path.join(getAgentvHome(), 'projects.yaml');
}

// ── Load / Save ─────────────────────────────────────────────────────────

export function loadProjectRegistry(): ProjectRegistry {
  const registryPath = getProjectsRegistryPath();
  if (!existsSync(registryPath)) {
    return { projects: [] };
  }
  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const parsed = parseYaml(raw);
    if (!parsed || !Array.isArray(parsed.projects)) {
      return { projects: [] };
    }
    return { projects: parsed.projects as ProjectEntry[] };
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
  writeFileSync(registryPath, stringifyYaml(registry), 'utf-8');
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

// ── Discovery ───────────────────────────────────────────────────────────

/**
 * Scan a directory tree (1 level deep) for directories containing `.agentv/`.
 * Returns absolute paths of discovered project directories.
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
  return results;
}
