import { describe, expect, it } from 'bun:test';

import { deriveSkillCallsFromToolCalls } from '../../../src/evaluation/providers/skill-calls.js';

describe('deriveSkillCallsFromToolCalls', () => {
  it('preserves explicit provider skill names without path-name validation', () => {
    const skillCalls = deriveSkillCallsFromToolCalls([
      { tool: 'Skill', input: { skill: 'codex/list_mcp_resources' } },
    ]);

    expect(skillCalls).toEqual([
      {
        name: 'codex/list_mcp_resources',
        input: { skill: 'codex/list_mcp_resources' },
        source: 'tool',
      },
    ]);
  });
});
