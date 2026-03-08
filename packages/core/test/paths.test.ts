import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  _resetForTesting,
  getAgentvHome,
  getGitCacheRoot,
  getSubagentsRoot,
  getTraceStateRoot,
  getWorkspacesRoot,
} from '../src/paths.js';

describe('paths', () => {
  const originalEnv = process.env.AGENTV_HOME;

  beforeEach(() => {
    _resetForTesting();
    delete process.env.AGENTV_HOME;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AGENTV_HOME = originalEnv;
    } else {
      delete process.env.AGENTV_HOME;
    }
  });

  describe('getAgentvHome', () => {
    it('returns ~/.agentv when AGENTV_HOME is not set', () => {
      expect(getAgentvHome()).toBe(path.join(os.homedir(), '.agentv'));
    });

    it('returns custom path when AGENTV_HOME is set', () => {
      process.env.AGENTV_HOME = '/custom/agentv';
      expect(getAgentvHome()).toBe('/custom/agentv');
    });
  });

  describe('convenience functions', () => {
    it('getWorkspacesRoot returns correct subpath', () => {
      expect(getWorkspacesRoot()).toBe(path.join(os.homedir(), '.agentv', 'workspaces'));
    });

    it('getGitCacheRoot returns correct subpath', () => {
      expect(getGitCacheRoot()).toBe(path.join(os.homedir(), '.agentv', 'git-cache'));
    });

    it('getSubagentsRoot returns correct subpath', () => {
      expect(getSubagentsRoot()).toBe(path.join(os.homedir(), '.agentv', 'subagents'));
    });

    it('getTraceStateRoot returns correct subpath', () => {
      expect(getTraceStateRoot()).toBe(path.join(os.homedir(), '.agentv', 'trace-state'));
    });

    it('convenience functions use AGENTV_HOME when set', () => {
      process.env.AGENTV_HOME = '/custom/home';
      expect(getWorkspacesRoot()).toBe('/custom/home/workspaces');
      expect(getGitCacheRoot()).toBe('/custom/home/git-cache');
      expect(getSubagentsRoot()).toBe('/custom/home/subagents');
      expect(getTraceStateRoot()).toBe('/custom/home/trace-state');
    });
  });

  describe('logging', () => {
    it('logs once when AGENTV_HOME is set', () => {
      process.env.AGENTV_HOME = '/custom/agentv';
      const spy = spyOn(console, 'warn').mockImplementation(() => {});

      getAgentvHome();
      getAgentvHome();
      getAgentvHome();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('Using AGENTV_HOME: /custom/agentv');
      spy.mockRestore();
    });

    it('does not log when AGENTV_HOME is not set', () => {
      const spy = spyOn(console, 'warn').mockImplementation(() => {});

      getAgentvHome();
      getAgentvHome();

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
