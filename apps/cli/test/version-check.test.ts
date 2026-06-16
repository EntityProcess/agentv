import { describe, expect, spyOn, test } from 'bun:test';
import packageJson from '../package.json' with { type: 'json' };
import {
  checkVersion,
  enforceRequiredVersion,
  formatRequiredVersionFailureNote,
} from '../src/version-check.js';

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

describe('enforceRequiredVersion', () => {
  test('warns and continues on mismatch by default', () => {
    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit should not be called');
    }) as never);

    try {
      const result = enforceRequiredVersion('>=99.0.0');

      expect(result.satisfied).toBe(false);
      expect(result.requiredRange).toBe('>=99.0.0');
      expect(exitSpy).not.toHaveBeenCalled();
      expect(String(stderrSpy.mock.calls[0]?.[0] ?? '')).toContain(
        `agentv ${packageJson.version} does not satisfy this project's required_version >=99.0.0`,
      );
      expect(String(stderrSpy.mock.calls[0]?.[0] ?? '')).toContain('agentv self update');
      expect(String(stderrSpy.mock.calls[0]?.[0] ?? '')).not.toContain('Update now?');
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('keeps strict mode as an explicit hard failure', () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    try {
      expect(() => enforceRequiredVersion('>=99.0.0', { strict: true })).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe('formatRequiredVersionFailureNote', () => {
  test('formats the eval failure diagnostic note', () => {
    const result = checkVersion('>=99.0.0');

    expect(formatRequiredVersionFailureNote(result)).toBe(
      `note: agentv ${packageJson.version} does not satisfy this project's required_version >=99.0.0 - this may be the cause. Run \`agentv self update\`.`,
    );
  });
});
