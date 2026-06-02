import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import os from 'node:os';
import path from 'node:path';

import {
  getAgentvConfigDir,
  getAgentvDataDir,
  getAgentvHome,
  getSubagentsRoot,
  getTraceStateRoot,
  getWorkspacePoolRoot,
  getWorkspacesRoot,
} from '../src/paths.js';

function setOptionalEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    process.env[name] = undefined;
  } else {
    process.env[name] = value;
  }
}

describe('paths', () => {
  const originalAgentvHome = process.env.AGENTV_HOME;
  const originalAgentvDataDir = process.env.AGENTV_DATA_DIR;

  beforeEach(() => {
    process.env.AGENTV_HOME = undefined;
    process.env.AGENTV_DATA_DIR = undefined;
  });

  afterEach(() => {
    setOptionalEnv('AGENTV_HOME', originalAgentvHome);
    setOptionalEnv('AGENTV_DATA_DIR', originalAgentvDataDir);
  });

  it('returns ~/.agentv when AGENTV_HOME is not set', () => {
    expect(getAgentvConfigDir()).toBe(path.join(os.homedir(), '.agentv'));
    expect(getAgentvHome()).toBe(path.join(os.homedir(), '.agentv'));
  });

  it('treats the string "undefined" as unset', () => {
    process.env.AGENTV_HOME = 'undefined';
    process.env.AGENTV_DATA_DIR = 'undefined';
    expect(getAgentvConfigDir()).toBe(path.join(os.homedir(), '.agentv'));
    expect(getAgentvDataDir()).toBe(path.join(os.homedir(), '.agentv'));
  });

  it('uses AGENTV_HOME as the lightweight config/home directory', () => {
    process.env.AGENTV_HOME = '/custom/agentv-home';
    expect(getAgentvConfigDir()).toBe('/custom/agentv-home');
    expect(getAgentvHome()).toBe('/custom/agentv-home');
  });

  it('defaults heavy data to the config/home directory', () => {
    process.env.AGENTV_HOME = '/custom/agentv-home';
    expect(getAgentvDataDir()).toBe('/custom/agentv-home');
  });

  it('uses AGENTV_DATA_DIR for heavy data when set', () => {
    process.env.AGENTV_HOME = '/custom/agentv-home';
    process.env.AGENTV_DATA_DIR = '/custom/agentv-data';
    expect(getAgentvConfigDir()).toBe('/custom/agentv-home');
    expect(getAgentvDataDir()).toBe('/custom/agentv-data');
  });

  it('heavy data helpers use AGENTV_DATA_DIR', () => {
    process.env.AGENTV_HOME = '/custom/agentv-home';
    process.env.AGENTV_DATA_DIR = '/custom/agentv-data';
    expect(getWorkspacesRoot()).toBe(path.join('/custom/agentv-data', 'workspaces'));
    expect(getSubagentsRoot()).toBe(path.join('/custom/agentv-data', 'subagents'));
    expect(getTraceStateRoot()).toBe(path.join('/custom/agentv-data', 'trace-state'));
    expect(getWorkspacePoolRoot()).toBe(path.join('/custom/agentv-data', 'workspace-pool'));
  });

  it('heavy data helpers default to ~/.agentv subpaths', () => {
    expect(getWorkspacesRoot()).toBe(path.join(os.homedir(), '.agentv', 'workspaces'));
    expect(getSubagentsRoot()).toBe(path.join(os.homedir(), '.agentv', 'subagents'));
    expect(getTraceStateRoot()).toBe(path.join(os.homedir(), '.agentv', 'trace-state'));
    expect(getWorkspacePoolRoot()).toBe(path.join(os.homedir(), '.agentv', 'workspace-pool'));
  });
});
