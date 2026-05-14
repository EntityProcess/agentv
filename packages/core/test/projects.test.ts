import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addProject,
  getProject,
  getProjectsRegistryPath,
  loadProjectRegistry,
  removeProject,
  touchProject,
} from '../src/projects.js';

describe('projects registry', () => {
  let fakeHome: string;
  let reposRoot: string;
  // biome-ignore lint/suspicious/noExplicitAny: spy typing from bun:test is intentionally loose.
  let homedirSpy: any;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), 'agentv-projects-'));
    reposRoot = mkdtempSync(path.join(os.tmpdir(), 'agentv-repos-'));
    homedirSpy = spyOn(os, 'homedir').mockReturnValue(fakeHome);
  });

  afterEach(() => {
    homedirSpy?.mockRestore?.();
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  function makeRepo(name: string): string {
    const dir = path.join(reposRoot, name);
    mkdirSync(path.join(dir, '.agentv'), { recursive: true });
    return dir;
  }

  it('starts empty and surfaces new entries after addProject', () => {
    expect(loadProjectRegistry().projects).toEqual([]);

    const repoPath = makeRepo('alpha');
    const entry = addProject(repoPath);
    expect(entry.name).toBe('alpha');
    expect(entry.path).toBe(path.resolve(repoPath));

    // Subsequent load reflects the write (per-request reload model).
    expect(loadProjectRegistry().projects).toHaveLength(1);
    expect(getProject(entry.id)?.path).toBe(entry.path);
  });

  it('addProject refuses a path with no .agentv/ directory', () => {
    const bare = mkdtempSync(path.join(os.tmpdir(), 'agentv-bare-'));
    expect(() => addProject(bare)).toThrow(/No \.agentv\/ directory found/);
    rmSync(bare, { recursive: true, force: true });
  });

  it('addProject is idempotent on the same path', () => {
    const repoPath = makeRepo('idempotent');
    const first = addProject(repoPath);
    const second = addProject(repoPath);
    expect(first.id).toBe(second.id);
    expect(loadProjectRegistry().projects).toHaveLength(1);
  });

  it('removeProject drops the entry by id', () => {
    const entry = addProject(makeRepo('to-remove'));
    expect(removeProject(entry.id)).toBe(true);
    expect(loadProjectRegistry().projects).toEqual([]);
    expect(removeProject(entry.id)).toBe(false);
  });

  it('touchProject updates lastOpenedAt without affecting other entries', () => {
    const a = addProject(makeRepo('a'));
    const b = addProject(makeRepo('b'));
    const originalB = loadProjectRegistry().projects.find((e) => e.id === b.id);

    touchProject(a.id);
    const reloadedA = loadProjectRegistry().projects.find((e) => e.id === a.id);
    const reloadedB = loadProjectRegistry().projects.find((e) => e.id === b.id);
    expect(reloadedA?.lastOpenedAt).not.toBe(a.lastOpenedAt);
    expect(reloadedB?.lastOpenedAt).toBe(originalB?.lastOpenedAt);
  });

  it('serializes project entries with snake_case keys on disk', () => {
    const entry = addProject(makeRepo('snake'));

    const yamlOnDisk = readFileSync(getProjectsRegistryPath(), 'utf-8');
    expect(yamlOnDisk).toContain('added_at:');
    expect(yamlOnDisk).toContain('last_opened_at:');
    expect(yamlOnDisk).not.toContain('addedAt:');
    expect(yamlOnDisk).not.toContain('lastOpenedAt:');

    // Round-trips cleanly back into the camelCase TS shape.
    const reloaded = loadProjectRegistry().projects.find((p) => p.id === entry.id);
    expect(reloaded).toMatchObject({
      id: entry.id,
      addedAt: entry.addedAt,
      lastOpenedAt: entry.lastOpenedAt,
    });
  });

  it('round-trips source field through YAML', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `projects:
  - id: remote-bench
    name: Remote Bench
    path: /srv/agentv/repo
    source:
      url: https://github.com/example/repo
      ref: main
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`,
      'utf-8',
    );

    const registry = loadProjectRegistry();
    expect(registry.projects).toHaveLength(1);
    const entry = registry.projects[0];
    expect(entry.source).toEqual({ url: 'https://github.com/example/repo', ref: 'main' });
  });

  it('interpolates env vars in source url', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    // Use concatenation to avoid JS template literal evaluating ${{ ... }}
    const d = '$';
    writeFileSync(
      registryPath,
      `projects:\n  - id: env-bench\n    name: Env Bench\n    path: /srv/agentv/repo\n    source:\n      url: "${d}{{ BENCH_URL }}"\n      ref: main\n    added_at: "2026-01-01T00:00:00Z"\n    last_opened_at: "2026-01-01T00:00:00Z"\n`,
      'utf-8',
    );

    const origUrl = process.env.BENCH_URL;
    try {
      process.env.BENCH_URL = 'https://github.com/example/bench-repo';
      const registry = loadProjectRegistry();
      expect(registry.projects[0].source?.url).toBe('https://github.com/example/bench-repo');
    } finally {
      if (origUrl === undefined) process.env.BENCH_URL = undefined;
      else process.env.BENCH_URL = origUrl;
    }
  });

  it('entries without source work unchanged', () => {
    const repoPath = makeRepo('no-source');
    const entry = addProject(repoPath);
    expect(entry.source).toBeUndefined();

    const reloaded = loadProjectRegistry().projects.find((p) => p.id === entry.id);
    expect(reloaded?.source).toBeUndefined();
  });
});

// ── Legacy benchmarks.yaml → projects.yaml migration ─────────────────────
// Migration runs on every loadProjectRegistry() call but only acts when the
// state demands it. These tests cover the four state transitions: legacy
// only, new only, both present, neither.

describe('legacy benchmarks.yaml migration', () => {
  let fakeHome: string;
  // biome-ignore lint/suspicious/noExplicitAny: spy typing from bun:test is intentionally loose.
  let homedirSpy: any;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), 'agentv-migration-'));
    homedirSpy = spyOn(os, 'homedir').mockReturnValue(fakeHome);
  });

  afterEach(() => {
    homedirSpy?.mockRestore?.();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function legacyPath(): string {
    return path.join(fakeHome, '.agentv', 'benchmarks.yaml');
  }

  function writeLegacy(content: string): void {
    mkdirSync(path.dirname(legacyPath()), { recursive: true });
    writeFileSync(legacyPath(), content, 'utf-8');
  }

  it('migrates legacy benchmarks.yaml to projects.yaml on first load', () => {
    writeLegacy(`benchmarks:
  - id: legacy-app
    name: Legacy App
    path: /srv/legacy
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-02T00:00:00Z"
`);

    const registry = loadProjectRegistry();

    // The migration ran: legacy gone, new file present, content preserved.
    expect(existsSync(legacyPath())).toBe(false);
    expect(existsSync(getProjectsRegistryPath())).toBe(true);
    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0]).toMatchObject({
      id: 'legacy-app',
      name: 'Legacy App',
      path: '/srv/legacy',
      addedAt: '2026-01-01T00:00:00Z',
      lastOpenedAt: '2026-01-02T00:00:00Z',
    });

    // On-disk YAML has the new top-level key.
    const yamlOnDisk = readFileSync(getProjectsRegistryPath(), 'utf-8');
    expect(yamlOnDisk).toContain('projects:');
    expect(yamlOnDisk).not.toMatch(/^benchmarks:/m);
  });

  it('is idempotent — second load is a no-op once migrated', () => {
    writeLegacy(`benchmarks:
  - id: legacy-app
    name: Legacy App
    path: /srv/legacy
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`);
    loadProjectRegistry(); // migrate
    const firstMtime = readFileSync(getProjectsRegistryPath(), 'utf-8');
    loadProjectRegistry(); // should be no-op
    const secondMtime = readFileSync(getProjectsRegistryPath(), 'utf-8');
    expect(secondMtime).toBe(firstMtime);
    expect(existsSync(legacyPath())).toBe(false);
  });

  it('prefers projects.yaml and warns when both files exist', () => {
    // Both files present, with different content.
    writeLegacy(`benchmarks:
  - id: stale
    name: Stale Legacy
    path: /srv/stale
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`);
    mkdirSync(path.dirname(getProjectsRegistryPath()), { recursive: true });
    writeFileSync(
      getProjectsRegistryPath(),
      `projects:
  - id: fresh
    name: Fresh
    path: /srv/fresh
    added_at: "2026-02-01T00:00:00Z"
    last_opened_at: "2026-02-01T00:00:00Z"
`,
      'utf-8',
    );

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = loadProjectRegistry();
      // Loaded from projects.yaml, not the legacy file.
      expect(registry.projects).toHaveLength(1);
      expect(registry.projects[0].id).toBe('fresh');
      // Legacy file is left in place for the operator to inspect/delete.
      expect(existsSync(legacyPath())).toBe(true);
      // Warning was emitted.
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore?.();
    }
  });

  it('is a no-op when neither file exists (fresh install)', () => {
    const registry = loadProjectRegistry();
    expect(registry.projects).toEqual([]);
    expect(existsSync(legacyPath())).toBe(false);
    // loadProjectRegistry doesn't pre-create the new file; saveProjectRegistry does.
    expect(existsSync(getProjectsRegistryPath())).toBe(false);
  });
});
