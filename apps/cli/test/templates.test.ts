import { describe, expect, test } from 'bun:test';

import { getAgentsTemplates } from '../src/templates/index.js';

describe('getAgentsTemplates', () => {
  test('includes onboarding skill templates from plugin source', () => {
    const templates = getAgentsTemplates();
    const paths = templates.map((template) => template.path);

    expect(paths).toContain('skills/agentv-onboarding/SKILL.md');
  });
});
