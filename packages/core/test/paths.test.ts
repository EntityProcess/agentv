import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import os from 'node:os';
import path from 'node:path';

import {
  _resetLoggedForTesting,
  getAgentvHome,
  getSubagentsRoot,
  getTraceStateRoot,
  getWorkspacesRoot,
} from '../src/paths.js';

describe('paths', () => {
  const originalEnv = process.env.AGENTV_HOME;

  beforeEach(() => {
    _resetLoggedForTesting();
    process.env.AGENTV_HOME = undefined;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AGENTV_HOME = originalEnv;
    } else {
      process.env.AGENTV_HOME = undefined;
    }
  });

  it('returns ~/.agentv when AGENTV_HOME is not set', () => {
    expect(getAgentvHome()).toBe(path.join(os.homedir(), '.agentv'));
  });

  it('treats the string "undefined" as unset', () => {
    process.env.AGENTV_HOME = 'undefined';
    expect(getAgentvHome()).toBe(path.join(os.homedir(), '.agentv'));
  });

  it('returns custom path when AGENTV_HOME is set', () => {
    process.env.AGENTV_HOME = '/custom/agentv';
    expect(getAgentvHome()).toBe('/custom/agentv');
  });

  it('getWorkspacesRoot returns correct subpath', () => {
    expect(getWorkspacesRoot()).toBe(path.join(os.homedir(), '.agentv', 'workspaces'));
  });

  it('getSubagentsRoot returns correct subpath', () => {
    expect(getSubagentsRoot()).toBe(path.join(os.homedir(), '.agentv', 'subagents'));
  });

  it('getTraceStateRoot returns correct subpath', () => {
    expect(getTraceStateRoot()).toBe(path.join(os.homedir(), '.agentv', 'trace-state'));
  });

  it('convenience functions respect AGENTV_HOME', () => {
    process.env.AGENTV_HOME = '/custom/home';
    expect(getWorkspacesRoot()).toBe(path.join('/custom/home', 'workspaces'));
    expect(getSubagentsRoot()).toBe(path.join('/custom/home', 'subagents'));
    expect(getTraceStateRoot()).toBe(path.join('/custom/home', 'trace-state'));
  });

  it('logs once when AGENTV_HOME is set', () => {
    process.env.AGENTV_HOME = '/custom/agentv';
    const spy = spyOn(console, 'warn').mockImplementation(() => {});
    getAgentvHome();
    getAgentvHome();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('Using AGENTV_HOME: /custom/agentv');
    spy.mockRestore();
  });

  it('does not log when AGENTV_HOME is not set', () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {});
    getAgentvHome();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
