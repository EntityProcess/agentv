import { describe, expect, it } from 'vitest';
import { isAgentvCliAvailable, resolveAgentvCommand, resolveSkillRoot } from '../paths.js';

describe('paths', () => {
  it('resolves skill root and agentv command without repo-root coupling', () => {
    const skillRoot = resolveSkillRoot();
    const agentvCmd = resolveAgentvCommand();

    // Validate skill root suffix
    expect(skillRoot.endsWith('plugins/agentv-dev/skills/agentv-optimizer')).toBe(true);

    // Validate agentv command is the installed binary
    expect(agentvCmd).toEqual(['agentv']);
  });

  it('isAgentvCliAvailable returns a structured result', () => {
    const result = isAgentvCliAvailable();
    expect(typeof result.available).toBe('boolean');
    if (!result.available) {
      expect(typeof result.reason).toBe('string');
    }
  });
});
