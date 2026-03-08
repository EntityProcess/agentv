import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('paths', () => {
  const originalEnv = process.env.AGENTV_HOME;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENTV_HOME;
    } else {
      process.env.AGENTV_HOME = originalEnv;
    }
  });

  it('returns ~/.agentv when AGENTV_HOME is not set', async () => {
    delete process.env.AGENTV_HOME;
    const { getAgentvHome } = await import('../src/paths.js');
    expect(getAgentvHome()).toBe(path.join(os.homedir(), '.agentv'));
  });

  it('returns AGENTV_HOME when set', async () => {
    process.env.AGENTV_HOME = '/custom/agentv';
    const { getAgentvHome } = await import('../src/paths.js');
    expect(getAgentvHome()).toBe('/custom/agentv');
  });

  it('getWorkspacesRoot returns correct subpath', async () => {
    process.env.AGENTV_HOME = '/custom/agentv';
    const { getWorkspacesRoot } = await import('../src/paths.js');
    expect(getWorkspacesRoot()).toBe('/custom/agentv/workspaces');
  });

  it('getGitCacheRoot returns correct subpath', async () => {
    process.env.AGENTV_HOME = '/custom/agentv';
    const { getGitCacheRoot } = await import('../src/paths.js');
    expect(getGitCacheRoot()).toBe('/custom/agentv/git-cache');
  });

  it('getSubagentsRoot returns correct subpath', async () => {
    process.env.AGENTV_HOME = '/custom/agentv';
    const { getSubagentsRoot } = await import('../src/paths.js');
    expect(getSubagentsRoot()).toBe('/custom/agentv/subagents');
  });

  it('getTraceStateRoot returns correct subpath', async () => {
    process.env.AGENTV_HOME = '/custom/agentv';
    const { getTraceStateRoot } = await import('../src/paths.js');
    expect(getTraceStateRoot()).toBe('/custom/agentv/trace-state');
  });

  it('logs once when AGENTV_HOME is set', async () => {
    process.env.AGENTV_HOME = '/custom/agentv';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getAgentvHome } = await import('../src/paths.js');
    getAgentvHome();
    getAgentvHome();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('Using AGENTV_HOME: /custom/agentv');
    warnSpy.mockRestore();
  });

  it('does not log when AGENTV_HOME is not set', async () => {
    delete process.env.AGENTV_HOME;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getAgentvHome } = await import('../src/paths.js');
    getAgentvHome();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
