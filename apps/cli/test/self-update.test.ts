import { describe, expect, test } from 'bun:test';
import {
  detectInstallScopeFromPath,
  detectPackageManagerFromPath,
} from '../src/commands/self/index.js';
import { getInstallArgs } from '../src/self-update.js';

describe('detectPackageManagerFromPath', () => {
  test('detects bun when path contains .bun', () => {
    expect(detectPackageManagerFromPath('/home/user/.bun/bin/agentv')).toBe('bun');
  });

  test('detects npm when path does not contain .bun', () => {
    expect(detectPackageManagerFromPath('/usr/local/bin/agentv')).toBe('npm');
  });

  test('detects npm for nvm-managed path', () => {
    expect(detectPackageManagerFromPath('/home/user/.nvm/versions/node/v20/bin/agentv')).toBe(
      'npm',
    );
  });

  test('defaults to npm for empty string', () => {
    expect(detectPackageManagerFromPath('')).toBe('npm');
  });
});

describe('detectInstallScopeFromPath', () => {
  test('detects local for project node_modules path', () => {
    expect(detectInstallScopeFromPath('/home/user/proj/node_modules/.bin/agentv')).toBe('local');
  });

  test('detects local for nested npx cache path', () => {
    expect(
      detectInstallScopeFromPath('/home/user/.npm/_npx/abc123/node_modules/agentv/dist/cli.js'),
    ).toBe('local');
  });

  test('detects global for system bin path', () => {
    expect(detectInstallScopeFromPath('/usr/local/bin/agentv')).toBe('global');
  });

  test('detects global for bun global bin path', () => {
    expect(detectInstallScopeFromPath('/home/user/.bun/bin/agentv')).toBe('global');
  });

  test('detects global for nvm-managed path without node_modules', () => {
    expect(detectInstallScopeFromPath('/home/user/.nvm/versions/node/v20/bin/agentv')).toBe(
      'global',
    );
  });

  test('detects local for Windows node_modules path', () => {
    expect(detectInstallScopeFromPath('C:\\Users\\dev\\proj\\node_modules\\.bin\\agentv.cmd')).toBe(
      'local',
    );
  });

  test('treats unrelated directory containing node_modules substring as global', () => {
    // A path with the substring but no actual `node_modules` path segment
    // (e.g. a third-party tool installed under /opt/my_node_modules_tool/)
    // must not be misclassified as local.
    expect(detectInstallScopeFromPath('/opt/my_node_modules_tool/bin/agentv')).toBe('global');
  });

  test('defaults to global for empty string', () => {
    expect(detectInstallScopeFromPath('')).toBe('global');
  });
});

describe('getInstallArgs', () => {
  test('global npm uses -g flag', () => {
    expect(getInstallArgs('npm', 'latest', 'global')).toEqual(['install', '-g', 'agentv@latest']);
  });

  test('local npm drops -g flag', () => {
    const args = getInstallArgs('npm', 'latest', 'local');
    expect(args).toEqual(['install', 'agentv@latest']);
    expect(args).not.toContain('-g');
  });

  test('global bun uses -g flag', () => {
    expect(getInstallArgs('bun', 'latest', 'global')).toEqual(['add', '-g', 'agentv@latest']);
  });

  test('local bun drops -g flag', () => {
    const args = getInstallArgs('bun', 'latest', 'local');
    expect(args).toEqual(['add', 'agentv@latest']);
    expect(args).not.toContain('-g');
  });

  test('forwards a semver range as the version spec', () => {
    expect(getInstallArgs('npm', '>=4.1.0', 'local')).toEqual(['install', 'agentv@>=4.1.0']);
  });
});
