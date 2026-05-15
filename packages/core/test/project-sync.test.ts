import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { syncProject, syncProjects } from '../src/project-sync.js';
import type { ProjectEntry } from '../src/projects.js';

function makeEntry(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    id: 'test-project',
    name: 'Test Project',
    path: '/tmp/fake-project',
    addedAt: '',
    lastOpenedAt: '',
    ...overrides,
  };
}

describe('syncProject', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-sync-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mock.restore();
  });

  it('throws when entry has no source', async () => {
    const entry = makeEntry({ path: tmpDir });
    await expect(syncProject(entry)).rejects.toThrow(/no source defined/);
  });

  it('runs git clone when .git does not exist', async () => {
    const spy = spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from(''));
    const dest = path.join(tmpDir, 'repo');
    const entry = makeEntry({
      path: dest,
      source: { url: 'https://github.com/example/repo', ref: 'main' },
    });
    await syncProject(entry);
    expect(spy).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--filter=blob:none',
        '--branch',
        'main',
        'https://github.com/example/repo',
        dest,
      ],
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('runs git pull --ff-only when .git already exists', async () => {
    mkdirSync(path.join(tmpDir, '.git'));
    const spy = spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from(''));
    const entry = makeEntry({
      path: tmpDir,
      source: { url: 'https://github.com/example/repo', ref: 'main' },
    });
    await syncProject(entry);
    expect(spy).toHaveBeenCalledWith(
      'git',
      ['-C', tmpDir, 'pull', '--ff-only'],
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });
});

describe('syncProjects', () => {
  afterEach(() => {
    mock.restore();
  });

  it('skips entries with no source', async () => {
    const spy = spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from(''));
    await syncProjects([makeEntry()]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('syncs entries that have a source', async () => {
    const spy = spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from(''));
    const entries = [
      makeEntry({ source: { url: 'https://github.com/example/repo', ref: 'main' } }),
    ];
    await syncProjects(entries);
    expect(spy).toHaveBeenCalled();
  });
});
