import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addBenchmark,
  addDiscoveryRoot,
  addExcludedPath,
  getBenchmarksRegistryPath,
  getDiscoveryRoots,
  getExcludedPaths,
  loadBenchmarkRegistry,
  removeDiscoveryRoot,
  removeExcludedPath,
  resolveActiveBenchmarks,
} from '../src/benchmarks.js';

describe('benchmarks registry + runtime discovery', () => {
  let fakeHome: string;
  let reposRoot: string;
  // biome-ignore lint/suspicious/noExplicitAny: spy typing from bun:test is intentionally loose.
  let homedirSpy: any;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), 'agentv-benchmarks-'));
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

  it('persists and lists discovery roots, omitting the key when empty', () => {
    expect(getDiscoveryRoots()).toEqual([]);
    expect(loadBenchmarkRegistry().discoveryRoots).toBeUndefined();

    const added = addDiscoveryRoot(reposRoot);
    expect(added).toBe(path.resolve(reposRoot));
    expect(getDiscoveryRoots()).toEqual([path.resolve(reposRoot)]);

    // Serialized keys on disk are snake_case per AGENTS.md wire-format convention,
    // even though the in-memory TS fields are camelCase.
    const yamlOnDisk = readFileSync(getBenchmarksRegistryPath(), 'utf-8');
    expect(yamlOnDisk).toContain('discovery_roots:');
    expect(yamlOnDisk).not.toContain('discoveryRoots:');

    // Adding the same root again is idempotent.
    addDiscoveryRoot(reposRoot);
    expect(getDiscoveryRoots()).toEqual([path.resolve(reposRoot)]);

    expect(removeDiscoveryRoot(reposRoot)).toBe(true);
    expect(getDiscoveryRoots()).toEqual([]);
    expect(loadBenchmarkRegistry().discoveryRoots).toBeUndefined();
  });

  it('surfaces repos appearing under a discovery root without restart', () => {
    addDiscoveryRoot(reposRoot);

    expect(resolveActiveBenchmarks()).toEqual([]);

    makeRepo('r1');
    const afterAdd = resolveActiveBenchmarks();
    expect(afterAdd).toHaveLength(1);
    expect(afterAdd[0]).toMatchObject({
      name: 'r1',
      path: path.resolve(reposRoot, 'r1'),
      source: 'discovered',
    });

    // Simulate removal: rm -rf the repo dir.
    rmSync(path.join(reposRoot, 'r1'), { recursive: true, force: true });
    expect(resolveActiveBenchmarks()).toEqual([]);
  });

  it('serializes benchmark entries with snake_case keys on disk', () => {
    const repoPath = makeRepo('snake');
    const entry = addBenchmark(repoPath);

    const yamlOnDisk = readFileSync(getBenchmarksRegistryPath(), 'utf-8');
    expect(yamlOnDisk).toContain('added_at:');
    expect(yamlOnDisk).toContain('last_opened_at:');
    expect(yamlOnDisk).not.toContain('addedAt:');
    expect(yamlOnDisk).not.toContain('lastOpenedAt:');

    // Round-trips cleanly back into the camelCase TS shape.
    const reloaded = loadBenchmarkRegistry().benchmarks.find((b) => b.id === entry.id);
    expect(reloaded).toMatchObject({
      id: entry.id,
      addedAt: entry.addedAt,
      lastOpenedAt: entry.lastOpenedAt,
    });
  });

  it('keeps manually-added entries even when their path is not under a root', () => {
    const outside = makeRepo('manual');
    const entry = addBenchmark(outside);

    const active = resolveActiveBenchmarks();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(entry.id);
    expect(active[0].source).toBe('manual');
  });

  it('hides a discovered repo once its path is excluded, and shows it again when unexcluded', () => {
    addDiscoveryRoot(reposRoot);
    const repoPath = makeRepo('junk');

    expect(resolveActiveBenchmarks().map((b) => b.path)).toEqual([repoPath]);

    const excluded = addExcludedPath(repoPath);
    expect(excluded).toBe(path.resolve(repoPath));
    expect(getExcludedPaths()).toEqual([path.resolve(repoPath)]);
    expect(resolveActiveBenchmarks()).toEqual([]);

    // Serialized form uses snake_case.
    const yamlOnDisk = readFileSync(getBenchmarksRegistryPath(), 'utf-8');
    expect(yamlOnDisk).toContain('excluded_paths:');
    expect(yamlOnDisk).not.toContain('excludedPaths:');

    // Unexclude → the repo reappears on the next scan.
    expect(removeExcludedPath(repoPath)).toBe(true);
    expect(getExcludedPaths()).toEqual([]);
    expect(resolveActiveBenchmarks().map((b) => b.path)).toEqual([repoPath]);
  });

  it('treats addExcludedPath on a pinned repo as a no-op', () => {
    const repoPath = makeRepo('already-pinned');
    addBenchmark(repoPath);

    // Returns the resolved path but does not persist an exclusion.
    expect(addExcludedPath(repoPath)).toBe(path.resolve(repoPath));
    expect(getExcludedPaths()).toEqual([]);
    // Pinned benchmark still shows up, unchanged.
    expect(resolveActiveBenchmarks().map((b) => b.path)).toEqual([repoPath]);
  });

  it('auto-unexcludes a path when it is manually pinned', () => {
    addDiscoveryRoot(reposRoot);
    const repoPath = makeRepo('pin-me');
    addExcludedPath(repoPath);
    expect(resolveActiveBenchmarks()).toEqual([]);

    // Pinning wins: addBenchmark should drop the exclusion.
    const entry = addBenchmark(repoPath);
    expect(getExcludedPaths()).toEqual([]);
    const active = resolveActiveBenchmarks();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(entry.id);
    expect(active[0].source).toBe('manual');
  });

  it('prefers the persisted entry when a discovery root would produce a duplicate path', () => {
    const repoPath = makeRepo('shared');
    // Register manually first.
    const manual = addBenchmark(repoPath);
    // Then configure a discovery root covering the same repo.
    addDiscoveryRoot(reposRoot);

    const active = resolveActiveBenchmarks();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(manual.id);
    expect(active[0].source).toBe('manual');
  });
});
