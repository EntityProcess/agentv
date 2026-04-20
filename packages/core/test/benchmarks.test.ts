import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addBenchmark,
  getBenchmark,
  getBenchmarksRegistryPath,
  loadBenchmarkRegistry,
  removeBenchmark,
  touchBenchmark,
} from '../src/benchmarks.js';

describe('benchmarks registry', () => {
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

  it('starts empty and surfaces new entries after addBenchmark', () => {
    expect(loadBenchmarkRegistry().benchmarks).toEqual([]);

    const repoPath = makeRepo('alpha');
    const entry = addBenchmark(repoPath);
    expect(entry.name).toBe('alpha');
    expect(entry.path).toBe(path.resolve(repoPath));

    // Subsequent load reflects the write (per-request reload model).
    expect(loadBenchmarkRegistry().benchmarks).toHaveLength(1);
    expect(getBenchmark(entry.id)?.path).toBe(entry.path);
  });

  it('addBenchmark refuses a path with no .agentv/ directory', () => {
    const bare = mkdtempSync(path.join(os.tmpdir(), 'agentv-bare-'));
    expect(() => addBenchmark(bare)).toThrow(/No \.agentv\/ directory found/);
    rmSync(bare, { recursive: true, force: true });
  });

  it('addBenchmark is idempotent on the same path', () => {
    const repoPath = makeRepo('idempotent');
    const first = addBenchmark(repoPath);
    const second = addBenchmark(repoPath);
    expect(first.id).toBe(second.id);
    expect(loadBenchmarkRegistry().benchmarks).toHaveLength(1);
  });

  it('removeBenchmark drops the entry by id', () => {
    const entry = addBenchmark(makeRepo('to-remove'));
    expect(removeBenchmark(entry.id)).toBe(true);
    expect(loadBenchmarkRegistry().benchmarks).toEqual([]);
    expect(removeBenchmark(entry.id)).toBe(false);
  });

  it('touchBenchmark updates lastOpenedAt without affecting other entries', () => {
    const a = addBenchmark(makeRepo('a'));
    const b = addBenchmark(makeRepo('b'));
    const originalB = loadBenchmarkRegistry().benchmarks.find((e) => e.id === b.id);

    touchBenchmark(a.id);
    const reloadedA = loadBenchmarkRegistry().benchmarks.find((e) => e.id === a.id);
    const reloadedB = loadBenchmarkRegistry().benchmarks.find((e) => e.id === b.id);
    expect(reloadedA?.lastOpenedAt).not.toBe(a.lastOpenedAt);
    expect(reloadedB?.lastOpenedAt).toBe(originalB?.lastOpenedAt);
  });

  it('serializes benchmark entries with snake_case keys on disk', () => {
    const entry = addBenchmark(makeRepo('snake'));

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
});
