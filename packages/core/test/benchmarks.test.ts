import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addBenchmark,
  addDiscoveryRoot,
  getDiscoveryRoots,
  loadBenchmarkRegistry,
  removeDiscoveryRoot,
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

  it('keeps manually-added entries even when their path is not under a root', () => {
    const outside = makeRepo('manual');
    const entry = addBenchmark(outside);

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
