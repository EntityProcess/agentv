import { describe, it, expect } from 'vitest';
import { parseVersion, isNewer } from './version-check.js';

describe('parseVersion', () => {
  it('should parse valid semver versions', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('0.0.1')).toEqual([0, 0, 1]);
    expect(parseVersion('10.20.30')).toEqual([10, 20, 30]);
  });

  it('should handle whitespace', () => {
    expect(parseVersion('  1.2.3  ')).toEqual([1, 2, 3]);
    expect(parseVersion('\n1.2.3\n')).toEqual([1, 2, 3]);
    expect(parseVersion('\t1.2.3\t')).toEqual([1, 2, 3]);
  });

  it('should return null for invalid versions', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(parseVersion('1')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('should return null for non-numeric versions', () => {
    expect(parseVersion('a.b.c')).toBeNull();
    expect(parseVersion('1.a.3')).toBeNull();
    expect(parseVersion('1.2.x')).toBeNull();
  });

  it('should return null for prerelease versions', () => {
    expect(parseVersion('1.2.3-alpha')).toBeNull();
    expect(parseVersion('1.2.3-beta.1')).toBeNull();
    expect(parseVersion('1.2.3-rc.1')).toBeNull();
  });

  it('should return null for versions with build metadata', () => {
    expect(parseVersion('1.2.3+build')).toBeNull();
    expect(parseVersion('1.2.3+20130313144700')).toBeNull();
  });
});

describe('isNewer', () => {
  it('should detect newer major versions', () => {
    expect(isNewer('2.0.0', '1.0.0')).toBe(true);
    expect(isNewer('10.0.0', '9.0.0')).toBe(true);
    expect(isNewer('1.0.0', '2.0.0')).toBe(false);
  });

  it('should detect newer minor versions', () => {
    expect(isNewer('1.2.0', '1.1.0')).toBe(true);
    expect(isNewer('1.10.0', '1.9.0')).toBe(true);
    expect(isNewer('1.1.0', '1.2.0')).toBe(false);
  });

  it('should detect newer patch versions', () => {
    expect(isNewer('1.2.3', '1.2.2')).toBe(true);
    expect(isNewer('1.2.10', '1.2.9')).toBe(true);
    expect(isNewer('1.2.2', '1.2.3')).toBe(false);
  });

  it('should return false for equal versions', () => {
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
    expect(isNewer('0.0.0', '0.0.0')).toBe(false);
  });

  it('should handle complex version comparisons', () => {
    expect(isNewer('2.1.0', '1.9.9')).toBe(true);
    expect(isNewer('1.10.0', '1.9.99')).toBe(true);
    expect(isNewer('1.2.100', '1.2.99')).toBe(true);
  });

  it('should return false for invalid versions', () => {
    expect(isNewer('invalid', '1.2.3')).toBe(false);
    expect(isNewer('1.2.3', 'invalid')).toBe(false);
    expect(isNewer('invalid', 'invalid')).toBe(false);
  });

  it('should handle whitespace in versions', () => {
    expect(isNewer('  1.2.3  ', '1.2.2')).toBe(true);
    expect(isNewer('1.2.3', '  1.2.2  ')).toBe(true);
    expect(isNewer('  1.2.3  ', '  1.2.2  ')).toBe(true);
  });

  it('should not consider prereleases as newer', () => {
    expect(isNewer('1.2.3-alpha', '1.2.2')).toBe(false);
    expect(isNewer('1.2.3', '1.2.2-beta')).toBe(false);
  });
});
