import { describe, expect, it } from 'bun:test';

import {
  deriveSkillCallsFromToolCalls,
  skillCallMetadata,
} from '../../../src/evaluation/providers/skill-calls.js';

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

  it('keeps failed skill reads out of confirmed skillCalls', () => {
    const metadata = skillCallMetadata([
      {
        name: 'csv-analyzer',
        path: '.agents/skills/csv-analyzer/SKILL.md',
        source: 'heuristic',
      },
      {
        name: 'broken-skill',
        path: '.agents/skills/broken-skill/SKILL.md',
        source: 'heuristic',
        isError: true,
      },
    ]);

    expect(metadata).toEqual({
      skillCalls: [
        {
          name: 'csv-analyzer',
          path: '.agents/skills/csv-analyzer/SKILL.md',
          source: 'heuristic',
        },
      ],
      attemptedSkillCalls: [
        {
          name: 'csv-analyzer',
          path: '.agents/skills/csv-analyzer/SKILL.md',
          source: 'heuristic',
        },
        {
          name: 'broken-skill',
          path: '.agents/skills/broken-skill/SKILL.md',
          source: 'heuristic',
          isError: true,
        },
      ],
    });
  });
});
