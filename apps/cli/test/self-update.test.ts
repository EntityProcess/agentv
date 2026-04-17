import { describe, expect, test } from 'bun:test';
import {
  detectInstallScopeFromPath,
  detectPackageManagerFromPath,
} from '../src/commands/self/index.js';

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

  test('defaults to global for empty string', () => {
    expect(detectInstallScopeFromPath('')).toBe('global');
  });
});
