import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addProject,
  getProject,
  getProjectsRegistryPath,
  loadProjectRegistry,
  removeProject,
  saveProjectRegistry,
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

  it('stores project registry entries under AGENTV_HOME config.yaml', () => {
    addProject(makeRepo('home-config'));

    expect(path.basename(getProjectsRegistryPath())).toBe('config.yaml');
    const yamlOnDisk = readFileSync(getProjectsRegistryPath(), 'utf-8');
    expect(yamlOnDisk).toContain('projects:');
  });

  it('round-trips repo_url and ref fields through YAML', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `projects:
  - id: remote-bench
    name: Remote Bench
    repo_url: git@github.com:example/repo.git
    path: /srv/agentv/repo
    ref: main
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`,
      'utf-8',
    );

    const registry = loadProjectRegistry();
    expect(registry.projects).toHaveLength(1);
    const entry = registry.projects[0];
    expect(entry.repoUrl).toBe('git@github.com:example/repo.git');
    expect(entry.ref).toBe('main');
  });

  it('round-trips nested source repo fields through YAML', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `projects:
  - id: nested-source
    name: Nested Source
    repo:
      url: git@github.com:example/repo.git
      branch: main
      path: /srv/agentv/repo
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`,
      'utf-8',
    );

    const registry = loadProjectRegistry();
    expect(registry.projects).toHaveLength(1);
    const entry = registry.projects[0];
    expect(entry).toMatchObject({
      repoUrl: 'git@github.com:example/repo.git',
      ref: 'main',
      path: '/srv/agentv/repo',
    });
  });

  it('drops removed project results push policy while preserving other sync config', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `projects:
  - id: results-project
    name: Results Project
    path: /srv/agentv/repo
    results:
      repo_url: https://github.com/EntityProcess/results-project-runs.git
      branch: agentv-results
      path: /srv/agentv/results/results-project
      sync:
        auto_push: true
        push_conflict_policy: backup_and_force_push
      branch_prefix: eval-results
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`,
      'utf-8',
    );

    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = loadProjectRegistry();
    try {
      expect(registry.projects[0].results).toEqual({
        repoUrl: 'https://github.com/EntityProcess/results-project-runs.git',
        branch: 'agentv-results',
        path: '/srv/agentv/results/results-project',
        sync: { autoPush: true },
        branchPrefix: 'eval-results',
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('backup_and_force_push'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('was ignored'));
    } finally {
      warn.mockRestore();
    }

    saveProjectRegistry(registry);
    const yamlOnDisk = readFileSync(registryPath, 'utf-8');
    expect(yamlOnDisk).toContain('repo:');
    expect(yamlOnDisk).toContain(
      'remote: https://github.com/EntityProcess/results-project-runs.git',
    );
    expect(yamlOnDisk).toContain('branch: agentv-results');
    expect(yamlOnDisk).toContain('path: /srv/agentv/results/results-project');
    expect(yamlOnDisk).toContain('auto_push: true');
    expect(yamlOnDisk).not.toContain('push_conflict_policy:');
    expect(yamlOnDisk).toContain('branch_prefix: eval-results');
    expect(yamlOnDisk).not.toContain('repo_url:');
    expect(yamlOnDisk).not.toContain('localPath:');
    expect(yamlOnDisk).not.toContain('local_path:');
    expect(yamlOnDisk).not.toContain('autoPush:');
    expect(yamlOnDisk).not.toContain('branchPrefix:');
  });

  it('round-trips branch-backed current-repo results config through YAML', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `projects:
  - id: branch-results
    name: Branch Results
    repo:
      url: git@github.com:example/source.git
      path: /srv/agentv/repo
    results:
      repo:
        remote: git@github.com:example/source.git
        path: .
        branch: agentv/results/v1
      sync:
        auto_push: false
        require_push: true
        push_conflict_policy: block
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`,
      'utf-8',
    );

    const registry = loadProjectRegistry();
    expect(registry.projects[0].results).toEqual({
      repoUrl: 'git@github.com:example/source.git',
      path: '.',
      branch: 'agentv/results/v1',
      sync: { autoPush: false, requirePush: true, pushConflictPolicy: 'block' },
    });

    saveProjectRegistry(registry);
    const yamlOnDisk = readFileSync(registryPath, 'utf-8');
    expect(yamlOnDisk).toContain('repo:');
    expect(yamlOnDisk).toContain('remote: git@github.com:example/source.git');
    expect(yamlOnDisk).toContain('path: .');
    expect(yamlOnDisk).toContain('branch: agentv/results/v1');
    expect(yamlOnDisk).toContain('auto_push: false');
    expect(yamlOnDisk).toContain('require_push: true');
    expect(yamlOnDisk).toContain('push_conflict_policy: block');
    expect(yamlOnDisk).not.toContain('repo_path:');
    expect(yamlOnDisk).not.toContain('repoPath:');
    expect(yamlOnDisk).not.toContain('requirePush:');
  });

  it('preserves legacy flat results remote aliases through YAML', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `projects:
  - id: legacy-results-remote
    name: Legacy Results Remote
    path: /srv/agentv/repo
    results:
      repo_path: .
      branch: agentv/results/v1
      remote: upstream
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`,
      'utf-8',
    );

    const registry = loadProjectRegistry();
    expect(registry.projects[0].results).toEqual({
      repoPath: '.',
      branch: 'agentv/results/v1',
      remote: 'upstream',
    });

    saveProjectRegistry(registry);
    const yamlOnDisk = readFileSync(registryPath, 'utf-8');
    expect(yamlOnDisk).toContain('repo_path: .');
    expect(yamlOnDisk).toContain('branch: agentv/results/v1');
    expect(yamlOnDisk).toContain('remote: upstream');
    expect(yamlOnDisk).not.toContain('results:\n      repo:\n');
  });

  it('preserves unrelated global config keys when saving projects', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `results:
  mode: github
  repo: EntityProcess/default-results
dashboard:
  app_name: AgentV
`,
      'utf-8',
    );

    addProject(makeRepo('preserve-global-config'));

    const yamlOnDisk = readFileSync(registryPath, 'utf-8');
    expect(yamlOnDisk).toContain('results:');
    expect(yamlOnDisk).toContain('repo: EntityProcess/default-results');
    expect(yamlOnDisk).toContain('dashboard:');
    expect(yamlOnDisk).toContain('projects:');
  });

  it('interpolates env vars in repo_url', () => {
    const registryPath = getProjectsRegistryPath();
    mkdirSync(path.dirname(registryPath), { recursive: true });
    // Use concatenation to avoid JS template literal evaluating ${{ ... }}
    const d = '$';
    writeFileSync(
      registryPath,
      `projects:\n  - id: env-bench\n    name: Env Bench\n    repo_url: "${d}{{ BENCH_REPO_URL }}"\n    path: /srv/agentv/repo\n    ref: main\n    added_at: "2026-01-01T00:00:00Z"\n    last_opened_at: "2026-01-01T00:00:00Z"\n`,
      'utf-8',
    );

    const origRepository = process.env.BENCH_REPO_URL;
    try {
      process.env.BENCH_REPO_URL = 'https://github.com/example/bench-repo.git';
      const registry = loadProjectRegistry();
      expect(registry.projects[0].repoUrl).toBe('https://github.com/example/bench-repo.git');
    } finally {
      if (origRepository === undefined) process.env.BENCH_REPO_URL = undefined;
      else process.env.BENCH_REPO_URL = origRepository;
    }
  });

  it('entries without repo_url work unchanged', () => {
    const repoPath = makeRepo('no-repository');
    const entry = addProject(repoPath);
    expect(entry.repoUrl).toBeUndefined();

    const reloaded = loadProjectRegistry().projects.find((p) => p.id === entry.id);
    expect(reloaded?.repoUrl).toBeUndefined();
  });
});
