import { describe, expect, test } from 'bun:test';
import packageJson from '../package.json' with { type: 'json' };
import { checkVersion } from '../src/version-check.js';

const [major, minor] = packageJson.version.split('.').map(Number);

describe('checkVersion', () => {
  test('satisfies range when current version is within range', () => {
    const result = checkVersion('>=2.0.0');
    expect(result.satisfied).toBe(true);
    expect(result.requiredRange).toBe('>=2.0.0');
  });

  test('does not satisfy range when current version is below', () => {
    const result = checkVersion('>=99.0.0');
    expect(result.satisfied).toBe(false);
    expect(result.requiredRange).toBe('>=99.0.0');
  });

  test('supports caret ranges', () => {
    const result = checkVersion(`^${major}.0.0`);
    expect(result.satisfied).toBe(true);
  });

  test('supports tilde ranges', () => {
    const result = checkVersion(`~${major}.${minor}.0`);
    expect(result.satisfied).toBe(true);
  });

  test('supports range intersections', () => {
    const result = checkVersion(`>=${major}.0.0 <${major + 1}.0.0`);
    expect(result.satisfied).toBe(true);
  });

  test('fails range intersection when current version is outside', () => {
    const result = checkVersion(`>=${major + 1}.0.0 <${major + 2}.0.0`);
    expect(result.satisfied).toBe(false);
  });

  test('throws on malformed semver range', () => {
    expect(() => checkVersion('not-a-range')).toThrow(/Invalid required_version/);
  });

  test('throws on empty string', () => {
    expect(() => checkVersion('')).toThrow(/Invalid required_version/);
  });

  test('returns the current version from package.json', () => {
    const result = checkVersion('>=1.0.0');
    expect(result.currentVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
