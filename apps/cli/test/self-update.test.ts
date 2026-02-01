import { describe, expect, test } from 'bun:test';
import { detectPackageManagerFromPath } from '../src/commands/self/index.js';

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
